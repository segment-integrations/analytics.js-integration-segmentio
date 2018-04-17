'use strict';

var Analytics = require('@segment/analytics.js-core').constructor;
var JSON = require('json3');
var Segment = require('../lib/');
var assert = require('proclaim');
var cookie = require('component-cookie');
var integration = require('@segment/analytics.js-integration');
var protocol = require('@segment/protocol');
var sandbox = require('@segment/clear-env');
var store = require('yields-store');
var tester = require('@segment/analytics.js-integration-tester');
var type = require('component-type');
var sinon = require('sinon');
var send = require('@segment/send-json');

// FIXME(ndhoule): clear-env's AJAX request clearing interferes with PhantomJS 2
// Detect Phantom env and use it to disable affected tests. We should use a
// better/more robust way of intercepting and canceling AJAX requests to avoid
// this hackery
var isPhantomJS = (/PhantomJS/).test(window.navigator.userAgent);

describe('Segment.io', function() {
  var segment;
  var analytics;
  var options;

  before(function() {
    // Just to make sure that `cookie()`
    // doesn't throw URIError we add a cookie
    // that will cause `decodeURIComponent()` to throw.
    document.cookie = 'bad=%';
  });

  beforeEach(function() {
    options = { apiKey: 'oq0vdlg7yi' };
    protocol.reset();
    analytics = new Analytics();
    segment = new Segment(options);
    analytics.use(Segment);
    analytics.use(tester);
    analytics.add(segment);
    analytics.assert(Segment.global === window);
    resetCookies();
  });

  afterEach(function() {
    analytics.restore();
    analytics.reset();
    resetCookies();
    segment.reset();
    sandbox();
  });

  function resetCookies() {
    store('s:context.referrer', null);
    cookie('s:context.referrer', null, { maxage: -1, path: '/' });
    store('segment_amp_id', null);
    cookie('segment_amp_id', null, { maxage: -1, path: '/' });
    store('seg_xid', null);
    cookie('seg_xid', null, { maxage: -1, path: '/' });
    store('seg_xid_fd', null);
    cookie('seg_xid_fd', null, { maxage: -1, path: '/' });
    store('seg_xid_ts', null);
    cookie('seg_xid_ts', null, { maxage: -1, path: '/' });
  }

  it('should have the right settings', function() {
    analytics.compare(Segment, integration('Segment.io')
      .option('apiKey', ''));
  });

  it('should always be turned on', function(done) {
    var Analytics = analytics.constructor;
    var ajs = new Analytics();
    ajs.use(Segment);
    ajs.initialize({ 'Segment.io': options });
    ajs.ready(function() {
      var segment = ajs._integrations['Segment.io'];
      segment.ontrack = sinon.spy();
      ajs.track('event', {}, { All: false });
      assert(segment.ontrack.calledOnce);
      done();
    });
  });

  describe('Segment.storage()', function() {
    it('should return cookie() when the protocol isnt file://', function() {
      analytics.assert(Segment.storage(), cookie);
    });

    it('should return store() when the protocol is file://', function() {
      analytics.assert(Segment.storage(), cookie);
      protocol('file:');
      analytics.assert(Segment.storage(), store);
    });

    it('should return store() when the protocol is chrome-extension://', function() {
      analytics.assert(Segment.storage(), cookie);
      protocol('chrome-extension:');
      analytics.assert(Segment.storage(), store);
    });
  });

  describe('before loading', function() {
    beforeEach(function() {
      analytics.stub(segment, 'load');
    });

    describe('#normalize', function() {
      var object;

      beforeEach(function() {
        segment.cookie('s:context.referrer', null);
        analytics.initialize();
        object = {};
      });

      it('should add .anonymousId', function() {
        analytics.user().anonymousId('anon-id');
        segment.normalize(object);
        analytics.assert(object.anonymousId === 'anon-id');
      });

      it('should add .sentAt', function() {
        segment.normalize(object);
        analytics.assert(object.sentAt);
        analytics.assert(type(object.sentAt) === 'date');
      });

      it('should add .userId', function() {
        analytics.user().id('user-id');
        segment.normalize(object);
        analytics.assert(object.userId === 'user-id');
      });

      it('should not replace the .userId', function() {
        analytics.user().id('user-id');
        object.userId = 'existing-id';
        segment.normalize(object);
        analytics.assert(object.userId === 'existing-id');
      });

      it('should always add .anonymousId even if .userId is given', function() {
        var object = { userId: 'baz' };
        segment.normalize(object);
        analytics.assert(object.anonymousId.length === 36);
      });

      it('should add .context', function() {
        segment.normalize(object);
        analytics.assert(object.context);
      });

      it('should not rewrite context if provided', function() {
        var ctx = {};
        var object = { context: ctx };
        segment.normalize(object);
        analytics.assert(object.context === ctx);
      });

      it('should copy .options to .context', function() {
        var opts = {};
        var object = { options: opts };
        segment.normalize(object);
        analytics.assert(object.context === opts);
        analytics.assert(object.options == null);
      });

      it('should add .writeKey', function() {
        segment.normalize(object);
        analytics.assert(object.writeKey === segment.options.apiKey);
      });

      it('should add .messageId', function() {
        segment.normalize(object);
        analytics.assert(object.messageId.length === 36);
      });

      it('should properly randomize .messageId', function() {
        var set = {};
        var count = 1000;
        for (var i = 0; i < count; i++) {
          var id = segment.normalize(object).messageId;
          set[id] = true;
        }
        analytics.assert(Object.keys(set).length === count);
      });

      it('should add .library', function() {
        segment.normalize(object);
        analytics.assert(object.context.library);
        analytics.assert(object.context.library.name === 'analytics.js');
        analytics.assert(object.context.library.version === analytics.VERSION);
      });

      it('should allow override of .library', function() {
        var ctx = {
          library: {
            name: 'analytics-wordpress',
            version: '1.0.3'
          }
        };
        var object = { context: ctx };
        segment.normalize(object);
        analytics.assert(object.context.library);
        analytics.assert(object.context.library.name === 'analytics-wordpress');
        analytics.assert(object.context.library.version === '1.0.3');
      });

      it('should add .userAgent', function() {
        segment.normalize(object);
        analytics.assert(object.context.userAgent === navigator.userAgent);
      });

      it('should add .campaign', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.search = '?utm_source=source&utm_medium=medium&utm_term=term&utm_content=content&utm_campaign=name';
        Segment.global.location.hostname = 'localhost';
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.campaign);
        analytics.assert(object.context.campaign.source === 'source');
        analytics.assert(object.context.campaign.medium === 'medium');
        analytics.assert(object.context.campaign.term === 'term');
        analytics.assert(object.context.campaign.content === 'content');
        analytics.assert(object.context.campaign.name === 'name');
        Segment.global = window;
      });

      it('should allow override of .campaign', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.search = '?utm_source=source&utm_medium=medium&utm_term=term&utm_content=content&utm_campaign=name';
        Segment.global.location.hostname = 'localhost';
        var object = {
          context: {
            campaign: {
              source: 'overrideSource',
              medium: 'overrideMedium',
              term: 'overrideTerm',
              content: 'overrideContent',
              name: 'overrideName'
            }
          }
        };
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.campaign);
        analytics.assert(object.context.campaign.source === 'overrideSource');
        analytics.assert(object.context.campaign.medium === 'overrideMedium');
        analytics.assert(object.context.campaign.term === 'overrideTerm');
        analytics.assert(object.context.campaign.content === 'overrideContent');
        analytics.assert(object.context.campaign.name === 'overrideName');
        Segment.global = window;
      });

      it('should add .referrer.id and .referrer.type', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.search = '?utm_source=source&urid=medium';
        Segment.global.location.hostname = 'localhost';
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.referrer);
        analytics.assert(object.context.referrer.id === 'medium');
        analytics.assert(object.context.referrer.type === 'millennial-media');
        Segment.global = window;
      });

      it('should add .referrer.id and .referrer.type from cookie', function() {
        segment.cookie('s:context.referrer', '{"id":"baz","type":"millennial-media"}');
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.search = '?utm_source=source';
        Segment.global.location.hostname = 'localhost';
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.referrer);
        analytics.assert(object.context.referrer.id === 'baz');
        analytics.assert(object.context.referrer.type === 'millennial-media');
        Segment.global = window;
      });

      it('should add .referrer.id and .referrer.type from cookie when no query is given', function() {
        segment.cookie('s:context.referrer', '{"id":"medium","type":"millennial-media"}');
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.search = '';
        Segment.global.location.hostname = 'localhost';
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.referrer);
        analytics.assert(object.context.referrer.id === 'medium');
        analytics.assert(object.context.referrer.type === 'millennial-media');
        Segment.global = window;
      });

      it('should add .amp.id from store', function() {
        segment.cookie('segment_amp_id', 'some-amp-id');
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(object.context.amp);
        analytics.assert(object.context.amp.id === 'some-amp-id');
      });

      it('should not add .amp if theres no segment_amp_id', function() {
        segment.normalize(object);
        analytics.assert(object);
        analytics.assert(object.context);
        analytics.assert(!object.context.amp);
      });

      describe('failed initializations', function() {
        it('should add failedInitializations as part of _metadata object if this.analytics.failedInitilizations is not empty', function() {
          var spy = sinon.spy(segment, 'normalize');
          var TestIntegration = integration('TestIntegration');
          TestIntegration.prototype.initialize = function() { throw new Error('Uh oh!'); };
          TestIntegration.prototype.page = function() {};
          var testIntegration = new TestIntegration();
          analytics.use(TestIntegration);
          analytics.add(testIntegration);
          analytics.initialize();
          analytics.page();
          assert(spy.returnValues[0]._metadata.failedInitializations[0] === 'TestIntegration');
        });
      });

      describe('unbundling', function() {
        var segment;

        beforeEach(function() {
          var Analytics = analytics.constructor;
          var ajs = new Analytics();
          segment = new Segment(options);
          ajs.use(Segment);
          ajs.use(integration('other'));
          ajs.add(segment);
          ajs.initialize({ other: {} });
        });

        it('should add a list of bundled integrations when `addBundledMetadata` is set', function() {
          segment.options.addBundledMetadata = true;
          segment.normalize(object);

          assert(object);
          assert(object._metadata);
          assert.deepEqual(object._metadata.bundled, [
            'Segment.io',
            'other'
          ]);
        });

        it('should add a list of unbundled integrations when `addBundledMetadata` and `unbundledIntegrations` are set', function() {
          segment.options.addBundledMetadata = true;
          segment.options.unbundledIntegrations = [ 'other2' ];
          segment.normalize(object);

          assert(object);
          assert(object._metadata);
          assert.deepEqual(object._metadata.unbundled, [ 'other2' ]);
        });

        it('should not add _metadata when `addBundledMetadata` is unset', function() {
          segment.normalize(object);

          assert(object);
          assert(!object._metadata);
        });
      });
    });
  });

  describe('after loading', function() {
    beforeEach(function(done) {
      analytics.once('ready', done);
      analytics.initialize();
      analytics.page();
    });

    describe('#page', function() {
      beforeEach(function() {
        analytics.stub(segment, 'enqueue');
      });

      it('should enqueue section, name and properties', function() {
        analytics.page('section', 'name', { property: true }, { opt: true });
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/p');
        analytics.assert(args[1].name === 'name');
        analytics.assert(args[1].category === 'section');
        analytics.assert(args[1].properties.property === true);
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#identify', function() {
      beforeEach(function() {
        analytics.stub(segment, 'enqueue');
      });

      it('should enqueue an id and traits', function() {
        analytics.identify('id', { trait: true }, { opt: true });
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/i');
        analytics.assert(args[1].userId === 'id');
        analytics.assert(args[1].traits.trait === true);
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#track', function() {
      beforeEach(function() {
        analytics.stub(segment, 'enqueue');
      });

      it('should enqueue an event and properties', function() {
        analytics.track('event', { prop: true }, { opt: true });
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/t');
        analytics.assert(args[1].event === 'event');
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].properties.prop === true);
        analytics.assert(args[1].traits == null);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#group', function() {
      beforeEach(function() {
        analytics.stub(segment, 'enqueue');
      });

      it('should enqueue groupId and traits', function() {
        analytics.group('id', { trait: true }, { opt: true });
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/g');
        analytics.assert(args[1].groupId === 'id');
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].traits.trait === true);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#alias', function() {
      beforeEach(function() {
        analytics.stub(segment, 'enqueue');
      });

      it('should enqueue .userId and .previousId', function() {
        analytics.alias('to', 'from');
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'from');
        analytics.assert(args[1].userId === 'to');
        analytics.assert(args[1].timestamp);
      });

      it('should fallback to user.anonymousId if .previousId is omitted', function() {
        analytics.user().anonymousId('anon-id');
        analytics.alias('to');
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'anon-id');
        analytics.assert(args[1].userId === 'to');
        analytics.assert(args[1].timestamp);
      });

      it('should fallback to user.anonymousId if .previousId and user.id are falsey', function() {
        analytics.alias('to');
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId);
        analytics.assert(args[1].previousId.length === 36);
        analytics.assert(args[1].userId === 'to');
      });

      it('should rename `.from` and `.to` to `.previousId` and `.userId`', function() {
        analytics.alias('user-id', 'previous-id');
        var args = segment.enqueue.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'previous-id');
        analytics.assert(args[1].userId === 'user-id');
        analytics.assert(args[1].from == null);
        analytics.assert(args[1].to == null);
      });
    });

    describe('#enqueue', function() {
      beforeEach(function() {
        analytics.spy(segment, 'session');
      });

      it('should use https: protocol when http:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('http:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when https:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when https:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('file:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when chrome-extension:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('chrome-extension:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should enqueue to `api.segment.io/v1` by default', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should enqueue to `options.apiHost` when set', sinon.test(function() {
        segment.options.apiHost = 'api.example.com';

        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.enqueue('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.example.com/i');
      }));

      it('should enqueue a normalized payload', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        var payload = {
          key1: 'value1',
          key2: 'value2'
        };

        segment.normalize = function() { return payload; };

        segment.enqueue('/i', {});

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(JSON.parse(req.requestBody).key1, 'value1');
        assert.strictEqual(JSON.parse(req.requestBody).key2, 'value2');
      }));
    });

    // FIXME(ndhoule): See note at `isPhantomJS` definition
    (isPhantomJS ? xdescribe : describe)('e2e tests — without queueing', function() {
      beforeEach(function() {
        segment.options.retryQueue = false;
      });

      describe('/g', function() {
        it('should succeed', function(done) {
          segment.enqueue('/g', { groupId: 'gid', userId: 'uid' }, function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
        });
      });

      describe('/p', function() {
        it('should succeed', function(done) {
          var data = { userId: 'id', name: 'page', properties: {} };
          segment.enqueue('/p', data, function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
        });
      });

      describe('/a', function() {
        it('should succeed', function(done) {
          var data = { userId: 'id', from: 'b', to: 'a' };
          segment.enqueue('/a', data, function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
        });
      });

      describe('/t', function() {
        it('should succeed', function(done) {
          var data = { userId: 'id', event: 'my-event', properties: {} };

          segment.enqueue('/t', data, function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
        });
      });

      describe('/i', function() {
        it('should succeed', function(done) {
          var data = { userId: 'id' };

          segment.enqueue('/i', data, function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
        });
      });
    });

    (isPhantomJS ? xdescribe : describe)('e2e tests — with queueing', function() {
      beforeEach(function() {
        segment.options.retryQueue = true;
        analytics.initialize();
      });

      describe('/g', function() {
        it('should succeed', function(done) {
          segment._lsqueue.on('processed', function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
          segment.enqueue('/g', { groupId: 'gid', userId: 'uid' });
        });
      });

      describe('/p', function() {
        it('should succeed', function(done) {
          segment._lsqueue.on('processed', function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
          segment.enqueue('/p', { userId: 'id', name: 'page', properties: {} });
        });
      });

      describe('/a', function() {
        it('should succeed', function(done) {
          segment._lsqueue.on('processed', function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
          segment.enqueue('/a', { userId: 'id', from: 'b', to: 'a' });
        });
      });

      describe('/t', function() {
        it('should succeed', function(done) {
          segment._lsqueue.on('processed', function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
          segment.enqueue('/t', { userId: 'id', event: 'my-event', properties: {} });
        });
      });

      describe('/i', function() {
        it('should succeed', function(done) {
          segment._lsqueue.on('processed', function(err, res) {
            if (err) return done(err);
            analytics.assert(JSON.parse(res.responseText).success);
            done();
          });
          segment.enqueue('/i', { userId: 'id' });
        });
      });
    });

    describe('#cookie', function() {
      beforeEach(function() {
        segment.cookie('foo', null);
      });

      it('should persist the cookie even when the hostname is "dev"', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.href = 'https://dev:300/path';
        analytics.assert(segment.cookie('foo') == null);
        segment.cookie('foo', 'bar');
        analytics.assert(segment.cookie('foo') === 'bar');
        Segment.global = window;
      });

      it('should persist the cookie even when the hostname is "127.0.0.1"', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.href = 'http://127.0.0.1:3000/';
        analytics.assert(segment.cookie('foo') == null);
        segment.cookie('foo', 'bar');
        analytics.assert(segment.cookie('foo') === 'bar');
        Segment.global = window;
      });

      it('should persist the cookie even when the hostname is "app.herokuapp.com"', function() {
        Segment.global = { navigator: {}, location: {} };
        Segment.global.location.href = 'https://app.herokuapp.com/about';
        Segment.global.location.hostname = 'app.herokuapp.com';
        analytics.assert(segment.cookie('foo') == null);
        segment.cookie('foo', 'bar');
        analytics.assert(segment.cookie('foo') === 'bar');
        Segment.global = window;
      });
    });

    describe('#crossDomainId', function() {
      var server;

      beforeEach(function() {
        server = sinon.fakeServer.create();
        segment.options.crossDomainIdServers = [
          'userdata.example1.com',
          'xid.domain2.com',
          'localhost'
        ];
        analytics.stub(segment, 'onidentify');
      });

      afterEach(function() {
        server.restore();
      });

      it('should migrate cookies from old to new name', function() {
        segment.cookie('segment_cross_domain_id', 'xid-test-1');
        segment.initialize();

        analytics.assert(segment.cookie('segment_cross_domain_id') == null);
        analytics.assert(segment.cookie('seg_xid') === 'xid-test-1');
      });

      it('should not crash with invalid config', function() {
        segment.options.crossDomainIdServers = undefined;

        var res = null;
        var err = null;
        segment.retrieveCrossDomainId(function(error, response) {
          res = response;
          err = error;
        });

        analytics.assert(!res);
        analytics.assert(err === 'crossDomainId not enabled');
      });

      it('should generate xid locally if there is only one (current hostname) server', function() {
        segment.options.crossDomainIdServers = [
          'localhost'
        ];

        var res = null;
        segment.retrieveCrossDomainId(function(err, response) {
          res = response;
        });

        var identify = segment.onidentify.args[0];
        var crossDomainId = identify[0].traits().crossDomainId;
        analytics.assert(crossDomainId);

        analytics.assert(res.crossDomainId === crossDomainId);
        analytics.assert(res.fromDomain === 'localhost');
      });

      it('should obtain crossDomainId', function() {
        var res = null;
        segment.retrieveCrossDomainId(function(err, response) {
          res = response;
        });
        server.respondWith('GET', 'https://xid.domain2.com/v1/id/' + segment.options.apiKey, [
          200,
          { 'Content-Type': 'application/json' },
          '{ "id": "xdomain-id-1" }'
        ]);
        server.respond();

        var identify = segment.onidentify.args[0];
        analytics.assert(identify[0].traits().crossDomainId === 'xdomain-id-1');

        analytics.assert(res.crossDomainId === 'xdomain-id-1');
        analytics.assert(res.fromDomain === 'xid.domain2.com');
      });

      it('should generate crossDomainId if no server has it', function() {
        var res = null;
        segment.retrieveCrossDomainId(function(err, response) {
          res = response;
        });

        server.respondWith('GET', 'https://xid.domain2.com/v1/id/' + segment.options.apiKey, [
          200,
          { 'Content-Type': 'application/json' },
          '{ "id": null }'
        ]);
        server.respondWith('GET', 'https://userdata.example1.com/v1/id/' + segment.options.apiKey, [
          200,
          { 'Content-Type': 'application/json' },
          '{ "id": null }'
        ]);
        server.respond();

        var identify = segment.onidentify.args[0];
        var crossDomainId = identify[0].traits().crossDomainId;
        analytics.assert(crossDomainId);

        analytics.assert(res.crossDomainId === crossDomainId);
        analytics.assert(res.fromDomain === 'localhost');
      });

      it('should bail if all servers error', function() {
        var err = null;
        var res = null;
        segment.retrieveCrossDomainId(function(error, response) {
          err = error;
          res = response;
        });

        server.respondWith('GET', 'https://xid.domain2.com/v1/id/' + segment.options.apiKey, [
          500,
          { 'Content-Type': 'application/json' },
          ''
        ]);
        server.respondWith('GET', 'https://userdata.example1.com/v1/id/' + segment.options.apiKey, [
          500,
          { 'Content-Type': 'application/json' },
          ''
        ]);
        server.respond();

        var identify = segment.onidentify.args[0];
        analytics.assert(!identify);
        analytics.assert(!res);
        analytics.assert(err === 'Internal Server Error');
      });

      it('should bail if some servers fail and others have no xid', function() {
        var err = null;
        var res = null;
        segment.retrieveCrossDomainId(function(error, response) {
          err = error;
          res = response;
        });

        server.respondWith('GET', 'https://xid.domain2.com/v1/id/' + segment.options.apiKey, [
          400,
          { 'Content-Type': 'application/json' },
          ''
        ]);
        server.respondWith('GET', 'https://userdata.example1.com/v1/id/' + segment.options.apiKey, [
          200,
          { 'Content-Type': 'application/json' },
          '{ "id": null }'
        ]);
        server.respond();

        var identify = segment.onidentify.args[0];
        analytics.assert(!identify);
        analytics.assert(!res);
        analytics.assert(err === 'Bad Request');
      });

      it('should succeed even if one server fails', function() {
        var err = null;
        var res = null;
        segment.retrieveCrossDomainId(function(error, response) {
          err = error;
          res = response;
        });

        server.respondWith('GET', 'https://xid.domain2.com/v1/id/' + segment.options.apiKey, [
          500,
          { 'Content-Type': 'application/json' },
          ''
        ]);
        server.respondWith('GET', 'https://userdata.example1.com/v1/id/' + segment.options.apiKey, [
          200,
          { 'Content-Type': 'application/json' },
          '{ "id": "xidxid" }'
        ]);
        server.respond();

        var identify = segment.onidentify.args[0];
        analytics.assert(identify[0].traits().crossDomainId === 'xidxid');

        analytics.assert(res.crossDomainId === 'xidxid');
        analytics.assert(res.fromDomain === 'userdata.example1.com');
        analytics.assert(!err);
      });
    });
  });

  describe('localStorage queueing', function() {
    beforeEach(function(done) {
      if (window.localStorage) {
        window.localStorage.clear();
      }
      analytics.once('ready', done);
      segment.options.retryQueue = true;
      analytics.initialize();
    });

    afterEach(function() {
      segment._lsqueue.stop();
    });

    it('#enqueue should add to the retry queue', function() {
      analytics.stub(segment._lsqueue, 'addItem');
      segment.enqueue('/i', { userId: '1' });
      assert(segment._lsqueue.addItem.calledOnce);
    });

    it('should send requests', function() {
      var xhr = sinon.useFakeXMLHttpRequest();
      var spy = sinon.spy();
      xhr.onCreate = spy;

      segment.enqueue('/i', { userId: '1' });

      assert(spy.calledOnce);
      var req = spy.getCall(0).args[0];
      var body = JSON.parse(req.requestBody);
      assert.equal(body.userId, '1');
    });
  });

  describe('send json', function() {
    it('should work', function(done) {
      var headers = { 'Content-Type': 'application/json' };

      send('http://httpbin.org/post', [1, 2, 3], headers, function(err, req) {
        if (err) return done(new Error(err.message));
        var res = JSON.parse(req.responseText);
        assert(res);
        done();
      });
    });
  });
});
