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
    store('segment_cross_domain_id', null);
    cookie('segment_cross_domain_id', null, { maxage: -1, path: '/' });
    store('segment_cross_domain_id_from_domain', null);
    cookie('segment_cross_domain_id_from_domain', null, { maxage: -1, path: '/' });
    store('segment_cross_domain_id_timestamp', null);
    cookie('segment_cross_domain_id_timestamp', null, { maxage: -1, path: '/' });
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
        analytics.stub(segment, 'send');
      });

      it('should send section, name and properties', function() {
        analytics.page('section', 'name', { property: true }, { opt: true });
        var args = segment.send.args[0];
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
        analytics.stub(segment, 'send');
      });

      it('should send an id and traits', function() {
        analytics.identify('id', { trait: true }, { opt: true });
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/i');
        analytics.assert(args[1].userId === 'id');
        analytics.assert(args[1].traits.trait === true);
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#track', function() {
      beforeEach(function() {
        analytics.stub(segment, 'send');
      });

      it('should send an event and properties', function() {
        analytics.track('event', { prop: true }, { opt: true });
        var args = segment.send.args[0];
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
        analytics.stub(segment, 'send');
      });

      it('should send groupId and traits', function() {
        analytics.group('id', { trait: true }, { opt: true });
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/g');
        analytics.assert(args[1].groupId === 'id');
        analytics.assert(args[1].context.opt === true);
        analytics.assert(args[1].traits.trait === true);
        analytics.assert(args[1].timestamp);
      });
    });

    describe('#alias', function() {
      beforeEach(function() {
        analytics.stub(segment, 'send');
      });

      it('should send .userId and .previousId', function() {
        analytics.alias('to', 'from');
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'from');
        analytics.assert(args[1].userId === 'to');
        analytics.assert(args[1].timestamp);
      });

      it('should fallback to user.anonymousId if .previousId is omitted', function() {
        analytics.user().anonymousId('anon-id');
        analytics.alias('to');
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'anon-id');
        analytics.assert(args[1].userId === 'to');
        analytics.assert(args[1].timestamp);
      });

      it('should fallback to user.anonymousId if .previousId and user.id are falsey', function() {
        analytics.alias('to');
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId);
        analytics.assert(args[1].previousId.length === 36);
        analytics.assert(args[1].userId === 'to');
      });

      it('should rename `.from` and `.to` to `.previousId` and `.userId`', function() {
        analytics.alias('user-id', 'previous-id');
        var args = segment.send.args[0];
        analytics.assert(args[0] === '/a');
        analytics.assert(args[1].previousId === 'previous-id');
        analytics.assert(args[1].userId === 'user-id');
        analytics.assert(args[1].from == null);
        analytics.assert(args[1].to == null);
      });
    });

    describe('#send', function() {
      beforeEach(function() {
        analytics.spy(segment, 'session');
      });

      it('should use https: protocol when http:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('http:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when https:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when https:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('file:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should use https: protocol when chrome-extension:', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('chrome-extension:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should send to `api.segment.io/v1` by default', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.segment.io/v1/i');
      }));

      it('should send to `options.apiHost` when set', sinon.test(function() {
        segment.options.apiHost = 'api.example.com';

        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        protocol('https:');
        segment.send('/i', { userId: 'id' });

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.url, 'https://api.example.com/i');
      }));

      it('should send a normalized payload', sinon.test(function() {
        var xhr = sinon.useFakeXMLHttpRequest();
        var spy = sinon.spy();
        xhr.onCreate = spy;

        var payload = {
          key1: 'value1',
          key2: 'value2'
        };

        segment.normalize = function() { return payload; };

        segment.send('/i', {});

        assert(spy.calledOnce);
        var req = spy.getCall(0).args[0];
        assert.strictEqual(req.requestBody, JSON.stringify(payload));
      }));

      describe('beacon', function() {
        beforeEach(function() {
          if (!navigator.sendBeacon) {
            navigator.sendBeacon = function() { return true; };
          }
        });

        it('should default to ajax', sinon.test(function() {
          var beacon = this.stub(navigator, 'sendBeacon').returns(true);

          var ajax = this.spy();
          var xhr = sinon.useFakeXMLHttpRequest();
          xhr.onCreate = ajax;

          segment.send('/i', { userId: 'id' });

          assert(!beacon.called);
          assert(ajax.calledOnce);
        }));

        it('should call beacon', sinon.test(function() {
          var beacon = this.stub(navigator, 'sendBeacon').returns(true);

          segment.options.beacon = true;

          segment.send('/i', { userId: 'id' });

          assert(beacon.calledOnce);
          var args = beacon.getCall(0).args;
          assert.strictEqual(args[0], 'https://api.segment.io/v1/i');
          assert(typeof args[1] === 'string');
        }));

        it('should not fallback to ajax on beacon success', sinon.test(function() {
          var beacon = this.stub(navigator, 'sendBeacon').returns(true);

          var ajax = this.spy();
          var xhr = sinon.useFakeXMLHttpRequest();
          xhr.onCreate = ajax;

          segment.options.beacon = true;

          segment.send('/i', { userId: 'id' });

          assert(beacon.calledOnce);
          assert(!ajax.called);
        }));

        it('should fallback to ajax on beacon failure', sinon.test(function() {
          var beacon = this.stub(navigator, 'sendBeacon').returns(false);

          var ajax = this.spy();
          var xhr = sinon.useFakeXMLHttpRequest();
          xhr.onCreate = ajax;

          segment.options.beacon = true;

          segment.send('/i', { userId: 'id' });

          assert(beacon.calledOnce);
          assert(ajax.calledOnce);
        }));

        it('should fallback to ajax if beacon is not supported', sinon.test(function() {
          navigator.sendBeacon = null;

          var ajax = this.spy();
          var xhr = sinon.useFakeXMLHttpRequest();
          xhr.onCreate = ajax;

          segment.options.beacon = true;

          segment.send('/i', { userId: 'id' });

          assert(ajax.calledOnce);
        }));

        it('should execute callback with no arguments', sinon.test(function(done) {
          var beacon = this.stub(navigator, 'sendBeacon').returns(true);

          var ajax = this.spy();
          var xhr = sinon.useFakeXMLHttpRequest();
          xhr.onCreate = ajax;

          segment.options.beacon = true;

          segment.send('/i', { userId: 'id' }, function(error, res) {
            assert(!error);
            assert(!res);
            assert(beacon.calledOnce);
            assert(!ajax.called);
            done();
          });
        }));
      });

      // FIXME(ndhoule): See note at `isPhantomJS` definition
      (isPhantomJS ? xdescribe : describe)('e2e tests', function() {
        describe('/g', function() {
          it('should succeed', function(done) {
            var data = { groupId: 'gid', userId: 'uid' };

            segment.send('/g', data, function(err, req) {
              if (err) return done(err);
              analytics.assert(JSON.parse(req.responseText).success);
              done();
            });
          });
        });

        describe('/p', function() {
          it('should succeed', function(done) {
            var data = { userId: 'id', name: 'page', properties: {} };

            segment.send('/p', data, function(err, req) {
              if (err) return done(err);
              analytics.assert(JSON.parse(req.responseText).success);
              done();
            });
          });
        });

        describe('/a', function() {
          it('should succeed', function(done) {
            var data = { userId: 'id', from: 'b', to: 'a' };

            segment.send('/a', data, function(err, req) {
              if (err) return done(err);
              analytics.assert(JSON.parse(req.responseText).success);
              done();
            });
          });
        });

        describe('/t', function() {
          it('should succeed', function(done) {
            var data = { userId: 'id', event: 'my-event', properties: {} };

            segment.send('/t', data, function(err, req) {
              if (err) return done(err);
              analytics.assert(JSON.parse(req.responseText).success);
              done();
            });
          });
        });

        describe('/i', function() {
          it('should succeed', function(done) {
            var data = { userId: 'id' };

            segment.send('/i', data, function(err, req) {
              if (err) return done(err);
              analytics.assert(JSON.parse(req.responseText).success);
              done();
            });
          });
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
          'userdata.domain2.com'
        ];
        analytics.stub(segment, 'onidentify');
      });
      
      afterEach(function() {
        server.restore();
      });
      
      it('should obtain crossDomainId', function() {
        var res = null;
        segment.retrieveCrossDomainId(function(err, response) {
          res = response;
        });
        
        // server.respondWith('GET', 'https://userdata.example1.com/v1/id/', [
        //   200,
        //   { 'Content-Type': 'application/json' },
        //   '{ "id": "xdomain-id-1" }'
        // ]);
        // server.respondWith('GET', 'https://userdata.domain2.com/v1/id/', [
        //   404,
        //   { 'Content-Type': 'application/json' },
        //   ''
        // ]);
        
        // TODO: Make this more deterministic
        server.requests[0].respond(200,
          { 'Content-Type': 'application/json' },
          '{ "id": "xdomain-id-1" }'
        );
        
        var identify = segment.onidentify.args[0];
        analytics.assert(identify[0].traits().crossDomainId === 'xdomain-id-1');
        
        analytics.assert(res.crossDomainId === 'xdomain-id-1');
        analytics.assert(res.fromDomain === 'userdata.example1.com');
      });
      
      it('should generate crossDomainId', function() {
        var res = null;
        segment.retrieveCrossDomainId(function(err, response) {
          res = response;
        });
        
        // TODO: Make this more deterministic
        server.requests[0].respond(200, { 'Content-Type': 'application/json' }, '{"id": null}');
        server.requests[1].respond(200, { 'Content-Type': 'application/json' }, '{"id": null}');
        
        var identify = segment.onidentify.args[0];
        var crossDomainId = identify[0].traits().crossDomainId;
        analytics.assert(crossDomainId);
        
        analytics.assert(res.crossDomainId === crossDomainId);
        analytics.assert(res.fromDomain === 'localhost');
      });
    });
  });
});
