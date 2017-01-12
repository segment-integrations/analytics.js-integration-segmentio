'use strict';

/**
 * Module dependencies.
 */

var ads = require('@segment/ad-params');
var clone = require('component-clone');
var cookie = require('component-cookie');
var extend = require('@ndhoule/extend');
var integration = require('@segment/analytics.js-integration');
var json = require('json3');
var keys = require('@ndhoule/keys');
var localstorage = require('yields-store');
var md5 = require('spark-md5').hash;
var protocol = require('@segment/protocol');
var send = require('@segment/send-json');
var topDomain = require('@segment/top-domain');
var utm = require('@segment/utm-params');
var uuid = require('uuid').v4;

/**
 * Cookie options
 */

var cookieOptions = {
  // 1 year
  maxage: 31536000000,
  secure: false,
  path: '/'
};

/**
 * Expose `Segment` integration.
 */

var Segment = exports = module.exports = integration('Segment.io')
  .option('apiKey', '')
  .option('apiHost', 'api.segment.io/v1')
  .option('crossDomainIdServers', [])
  .option('beacon', false)
  .option('addBundledMetadata', false)
  .option('unbundledIntegrations', []);

/**
 * Get the store.
 *
 * @return {Function}
 */

exports.storage = function() {
  return protocol() === 'file:' || protocol() === 'chrome-extension:' ? localstorage : cookie;
};

/**
 * Expose global for testing.
 */

exports.global = window;

/**
 * Initialize.
 *
 * https://github.com/segmentio/segmentio/blob/master/modules/segmentjs/segment.js/v1/segment.js
 *
 * @api public
 */

Segment.prototype.initialize = function() {
  var self = this;
  this.ready();
  this.analytics.on('invoke', function(msg) {
    var action = msg.action();
    var listener = 'on' + msg.action();
    self.debug('%s %o', action, msg);
    if (self[listener]) self[listener](msg);
    self.ready();
  });
  // At this moment we intentionally do not want events to be queued while we retrieve the `crossDomainId`
  // so `.ready` will get called right away and we'll try to figure out `crossDomainId`
  // separately
  if (this.options.crossDomainIdServers && this.options.crossDomainIdServers.length > 0) {
    this.retrieveCrossDomainId();
  }
};

/**
 * retrieveCrossDomainId.
 *
 * @api private
 */
Segment.prototype.retrieveCrossDomainId = function(onCrossDomainIdReady) {
  var self = this;
  var crossDomainId = this.cookie('segment_cross_domain_id');
  if (!crossDomainId) {
    var currentTld = getTld(window.location.hostname);
    var domains = this.options.crossDomainIdServers;
    var writeKey = this.options.apiKey;
    var crossDomainIdFound = false;
    var finishedRequests = 0;
    for (var i=0; i<domains.length; i++) {
      var domain = domains[i];
      if (getTld(domain) === currentTld) {
        finishedRequests++;
        continue;
      }
      var endpoint = 'https://' + domain + '/v1/id/';
      // For v0 we're just gonna grab the first id that came back
      getJsonWithAuth(endpoint, writeKey, '', function(err, resJson) {
        finishedRequests++;
        if (resJson && resJson.id && !crossDomainIdFound) {
          crossDomainIdFound = true;
          crossDomainId = resJson.id;
          self.cookie('segment_cross_domain_id', crossDomainId);
          self.analytics.identify({
            crossDomainId: crossDomainId
          });
          self.analytics.track('Cross Domain ID Obtained', {
            crossDomainId: crossDomainId,
            fromDomain: domain,
            currentDomain: window.location.hostname
          });
          if (onCrossDomainIdReady) {
            onCrossDomainIdReady(crossDomainId);
          }
        } else if (finishedRequests === domains.length) {
          // So all requests have finished but we still did not find a crossDomainId, let's just set one now
          crossDomainId = uuid();
          self.cookie('segment_cross_domain_id', crossDomainId);
          self.analytics.identify({
            crossDomainId: crossDomainId
          });
          self.analytics.track('Cross Domain ID Generated', {
            crossDomainId: crossDomainId,
            currentDomain: window.location.hostname
          });
          if (onCrossDomainIdReady) {
            onCrossDomainIdReady(crossDomainId);
          }
        }
      });
    }
  }
};

/**
 * Loaded.
 *
 * @api private
 * @return {boolean}
 */

Segment.prototype.loaded = function() {
  return true;
};

/**
 * Page.
 *
 * @api public
 * @param {Page} page
 */

Segment.prototype.onpage = function(page) {
  this.send('/p', page.json());
};

/**
 * Identify.
 *
 * @api public
 * @param {Identify} identify
 */

Segment.prototype.onidentify = function(identify) {
  this.send('/i', identify.json());
};

/**
 * Group.
 *
 * @api public
 * @param {Group} group
 */

Segment.prototype.ongroup = function(group) {
  this.send('/g', group.json());
};

/**
 * ontrack.
 *
 * TODO: Document this.
 *
 * @api private
 * @param {Track} track
 */

Segment.prototype.ontrack = function(track) {
  var json = track.json();
  // TODO: figure out why we need traits.
  delete json.traits;
  this.send('/t', json);
};

/**
 * Alias.
 *
 * @api public
 * @param {Alias} alias
 */

Segment.prototype.onalias = function(alias) {
  var json = alias.json();
  var user = this.analytics.user();
  json.previousId = json.previousId || json.from || user.id() || user.anonymousId();
  json.userId = json.userId || json.to;
  delete json.from;
  delete json.to;
  this.send('/a', json);
};

/**
 * Normalize the given `msg`.
 *
 * @api private
 * @param {Object} msg
 */

Segment.prototype.normalize = function(msg) {
  this.debug('normalize %o', msg);
  var user = this.analytics.user();
  var global = exports.global;
  var query = global.location.search;
  var ctx = msg.context = msg.context || msg.options || {};
  delete msg.options;
  msg.writeKey = this.options.apiKey;
  ctx.userAgent = navigator.userAgent;
  if (!ctx.library) ctx.library = { name: 'analytics.js', version: this.analytics.VERSION };
  if (query) ctx.campaign = utm(query);
  this.referrerId(query, ctx);
  msg.userId = msg.userId || user.id();
  msg.anonymousId = user.anonymousId();
  msg.sentAt = new Date();
  if (this.options.addBundledMetadata) {
    var bundled = keys(this.analytics.Integrations);
    msg._metadata = {
      bundled: bundled,
      unbundled: this.options.unbundledIntegrations
    };
  }
  // add some randomness to the messageId checksum
  msg.messageId = 'ajs-' + md5(json.stringify(msg) + uuid());
  this.debug('normalized %o', msg);
  this.ampId(ctx);
  return msg;
};

/**
 * Add amp id if it exists.
 *
 * @param {Object} ctx
 */

Segment.prototype.ampId = function(ctx) {
  var ampId = this.cookie('segment_amp_id');
  if (ampId) ctx.amp = { id: ampId };
};

/**
 * Send `obj` to `path`.
 *
 * @api private
 * @param {string} path
 * @param {Object} obj
 * @param {Function} fn
 */

Segment.prototype.send = function(path, msg, fn) {
  var url = 'https://' + this.options.apiHost + path;
  fn = fn || noop;
  var self = this;

  // msg
  msg = this.normalize(msg);

  // send
  if (this.options.beacon && navigator.sendBeacon) {
    // Beacon returns false if the browser couldn't queue the data for transfer
    // (e.g: the data was too big)
    if (navigator.sendBeacon(url, json.stringify(msg))) {
      self.debug('beacon sent %o', msg);
      fn();
    } else {
      self.debug('beacon failed, falling back to ajax %o', msg);
      sendAjax();
    }
  } else {
    sendAjax();
  }

  function sendAjax() {
    // Beacons are sent as a text/plain POST
    var headers = { 'Content-Type': 'text/plain' };
    send(url, msg, headers, function(err, res) {
      self.debug('ajax sent %o, received %o', msg, arguments);
      if (err) return fn(err);
      res.url = url;
      fn(null, res);
    });
  }
};

/**
 * Gets/sets cookies on the appropriate domain.
 *
 * @api private
 * @param {string} name
 * @param {*} val
 */

Segment.prototype.cookie = function(name, val) {
  var store = Segment.storage();
  if (arguments.length === 1) return store(name);
  var global = exports.global;
  var href = global.location.href;
  var domain = '.' + topDomain(href);
  if (domain === '.') domain = '';
  this.debug('store domain %s -> %s', href, domain);
  var opts = clone(cookieOptions);
  opts.domain = domain;
  this.debug('store %s, %s, %o', name, val, opts);
  store(name, val, opts);
  if (store(name)) return;
  delete opts.domain;
  this.debug('fallback store %s, %s, %o', name, val, opts);
  store(name, val, opts);
};

/**
 * Add referrerId to context.
 *
 * TODO: remove.
 *
 * @api private
 * @param {Object} query
 * @param {Object} ctx
 */

Segment.prototype.referrerId = function(query, ctx) {
  var stored = this.cookie('s:context.referrer');
  var ad;

  if (stored) stored = json.parse(stored);
  if (query) ad = ads(query);

  ad = ad || stored;

  if (!ad) return;
  ctx.referrer = extend(ctx.referrer || {}, ad);
  this.cookie('s:context.referrer', json.stringify(ad));
};

/**
 * Noop.
 */

function noop() {}

/**
 * getJsonWithAuth
 * TODO: Add some queuing (multiple requests) and retry?
 */
function getJsonWithAuth(url, username, password, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  if (username || password) {
    xhr.setRequestHeader('Authorization', 'Basic ' + btoa(username + ':' + password));
  }
  xhr.withCredentials = true;
  xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      if (xhr.status >= 200 && xhr.status < 300) {
        callback(null, json.parse(xhr.responseText));
      } else {
        callback(xhr.statusText, null);
      }
    }
  };
  xhr.send();
}

//  Get domain.com from subdomain.domain.com, etc.
function getTld(domain) {
  return domain.split('.').splice(-2).join('.');
}