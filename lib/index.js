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
var Queue = require('@segment/localstorage-retry');

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
  .option('retryQueue', false)
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

  if (this.options.retryQueue) {
    this._lsqueue = new Queue('segmentio', function(item, done) {
      // Update the sentAt time each retry so the tracking-api doesn't interperet a time skew
      item.sentAt = new Date();
      // send
      send(item.url, item.msg, item.headers, function(err, res) {
        self.debug('sent %O, received %O', item.msg, arguments);
        if (err) return done(err);
        res.url = item.url;
        done();
      });
    });
    this._lsqueue.start();
  }

  this.ready();
  this.analytics.on('invoke', function(msg) {
    var action = msg.action();
    var listener = 'on' + msg.action();
    self.debug('%s %o', action, msg);
    if (self[listener]) self[listener](msg);
    self.ready();
  });
  // Migrate from old cross domain id cookie names
  if (this.cookie('segment_cross_domain_id')) {
    this.cookie('seg_xid', this.cookie('segment_cross_domain_id'));
    this.cookie('seg_xid_fd', this.cookie('segment_cross_domain_id_from_domain'));
    this.cookie('seg_xid_ts', this.cookie('segment_cross_domain_id_timestamp'));
    this.cookie('segment_cross_domain_id', null);
    this.cookie('segment_cross_domain_id_from_domain', null);
    this.cookie('segment_cross_domain_id_timestamp', null);
  }
  // At this moment we intentionally do not want events to be queued while we retrieve the `crossDomainId`
  // so `.ready` will get called right away and we'll try to figure out `crossDomainId`
  // separately
  if (this.options.crossDomainIdServers && this.options.crossDomainIdServers.length > 0) {
    this.retrieveCrossDomainId();
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
  if (this.options.crossDomainIdServers) {
    var crossDomainId = this.cookie('seg_xid');
    if (crossDomainId) {
      if (!ctx.traits) {
        ctx.traits = { crossDomainId: crossDomainId };
      } else if (ctx.traits && !ctx.traits.crossDomainId) {
        ctx.traits.crossDomainId = crossDomainId;
      }
    }
  }
  // if user provides campaign via context, do not overwrite with UTM qs param
  if (query && !ctx.campaign) {
    ctx.campaign = utm(query);
  }
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
  if (this.options.retryQueue) {
    var headers = { 'Content-Type': 'text/plain' };
    this._lsqueue.addItem({
      url: url,
      headers: headers,
      msg: msg
    });
  } else if (this.options.beacon && navigator.sendBeacon) {
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
 * retrieveCrossDomainId.
 *
 * @api private
 * @param {function) callback => err, {crossDomainId, fromServer, timestamp}
 */
Segment.prototype.retrieveCrossDomainId = function(callback) {
  if (!this.options.crossDomainIdServers) {
    if (callback) {
      callback(new Error('crossDomainId not enabled'));
    }
    return;
  }
  if (!this.cookie('seg_xid')) {
    var self = this;
    var writeKey = this.options.apiKey;

    // Exclude the current domain from the list of servers we're querying.
    var currentTld = getTld(window.location.hostname);
    var domains = [];
    for (var i=0; i<this.options.crossDomainIdServers.length; i++) {
      var domain = this.options.crossDomainIdServers[i];
      if (getTld(domain) !== currentTld) {
        domains.push(domain);
      }
    }

    getCrossDomainIdFromServerList(domains, writeKey, function(err, res) {
      if (err) {
        // We optimize for no conflicting xid as much as possible. So bail out if there is an
        // error and we cannot be sure that xid does not exist on any other domains.
        if (callback) {
          callback(err, null);
        }
        return;
      }
      var crossDomainId = null;
      var fromDomain = null;
      if (res) {
        crossDomainId = res.id;
        fromDomain = res.domain;
      } else {
        crossDomainId = uuid();
        fromDomain = window.location.hostname;
      }
      var currentTimeMillis = (new Date()).getTime();
      self.cookie('seg_xid', crossDomainId);
      // Not actively used. Saving for future conflict resolution purposes
      self.cookie('seg_xid_fd', fromDomain);
      self.cookie('seg_xid_ts', currentTimeMillis);
      self.analytics.identify({
        crossDomainId: crossDomainId
      });
      if (callback) {
        callback(null, {
          crossDomainId: crossDomainId,
          fromDomain: fromDomain,
          timestamp: currentTimeMillis
        });
      }
    });
  }
};

/**
 * getCrossDomainIdFromServers
 * @param {Array} domains
 * @param {string} writeKey
 * @param {function} callback => err, {domain, id}
 */
function getCrossDomainIdFromServerList(domains, writeKey, callback) {
  // Should not happen but special case
  if (domains.length === 0) {
    callback(null, null);
  }
  var crossDomainIdFound = false;
  var finishedRequests = 0;
  var error = null;
  for (var i=0; i<domains.length; i++) {
    var domain = domains[i];

    getCrossDomainIdFromSingleServer(domain, writeKey, function(err, res) {
      finishedRequests++;
      if (err) {
        // if request against a particular domain fails, we won't early exit
        // but rather wait and see if requests to other domains succeed
        error = err;
      } else if (res && res.id && !crossDomainIdFound) {
        // If we found an xid from any of the servers, we'll just early exit and callback
        crossDomainIdFound = true;
        callback(null, res);
      }
      if (finishedRequests === domains.length && !crossDomainIdFound) {
        // Error is non-null if we encountered an issue, otherwise error will be null
        // meaning that no domains in the list has an xid for current user
        callback(error, null);
      }
    });
  }
}

/**
 * getCrossDomainId
 * @param {Array} domain
 * @param {string} writeKey
 * @param {function} callback => err, {domain, id}
 */
function getCrossDomainIdFromSingleServer(domain, writeKey, callback) {
  var endpoint = 'https://' + domain + '/v1/id/' + writeKey;
  getJson(endpoint, function(err, res) {
    if (err) {
      callback(err);
    } else {
      callback(null, {
        domain: domain,
        id: res && res.id || null
      });
    }
  });
}

/**
 * getJson
 * @param {string} url
 * @param {function} callback => err, json
 */
function getJson(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.withCredentials = true;
  xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      if (xhr.status >= 200 && xhr.status < 300) {
        callback(null, xhr.responseText ? json.parse(xhr.responseText) : null);
      } else {
        callback(xhr.statusText || 'Unknown Error', null);
      }
    }
  };
  xhr.send();
}

/**
 * getTld
 *
 * Get domain.com from subdomain.domain.com, etc.
 *
 * Note that topDomain only works correctly if you currently on the domain
 * you're checking. This is ok for us, since if you are on segment.com
 * we want topDomain('xid.segment.com') to return segment.com
 * and don't care about topDomain('xid.nightmarejs.org') returning "".
 * topDomain('localhost') returns '' so we need an explicit check for it.
 *
 * @param {string} domain
 */
function getTld(domain) {
  if (domain === 'localhost') {
    return 'localhost';
  }
  return topDomain(window.location.hostname);
}


/**
 * Noop.
 */
function noop() {}
