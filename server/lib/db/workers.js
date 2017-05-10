(function() {
  'use strict';

  const WORKERS = 'workers';

  const ff = require('ff');
  const Mongo = require('./mongo');

  function Workers() {
    this.name = WORKERS;
  }

  Workers.prototype = new Mongo();
    /* Could be useful for later.
    get: function(workerId, ip, agent, cb) {
      let db;

      let f = ff(() => {
        mongo.getDB(f());
      },

        _db => {
          db = _db;
          db.collection(WORKERS).findOneAndUpdate(
            { workerId: workerId },
            {
              $setOnInsert: {
                workerId: workerId,
                joined: new Date(),
                submissions: 0,
              },
              $set: {
                updated: new Date(),
              },
              $inc: { accessed: 1 },
              $addToSet: { ips: ip, userAgents: agent },
            },
            { upsert: true, returnOriginal: false}, f());
        });

      f.onComplete(cb);
    },
    */
  Workers.prototype.track = function(type, workerId, ip, agent) {
    let db;

    let setOnInsert = {
      workerId: workerId,
      joined: new Date(),
      accessRecord: 0,
      accessVerify: 0,
      submissionsRecord: 0,
      submissionsVerify: 0,
    };

    let inc = {
      accessRecord: 1,
      accessVerify: 1
    };

    // We can't have both access types in both setOnInsert
    // and inc because mongo does not allow this.
    if (type === 'record') {
      delete setOnInsert.accessRecord;
      delete inc.accessVerify;
    } else if (type === 'verify') {
      delete setOnInsert.accessVerify;
      delete inc.accessRecord;
    } else {
      console.error('unrecognized tracking type', type);
      throw 'no type';
    }

    let f = ff(() => {
      this.getDB(f());
    },

      _db => {
        db = _db;
        db.collection(this.name).updateOne(
          { workerId: workerId },
          {
            $setOnInsert: setOnInsert,
            $set: {
              updated: new Date(),
            },
            $inc: inc,
            $addToSet: { ips: ip, userAgents: agent },
          },
          { upsert: true });
      });
  };

  Workers.prototype.trackRecord = function(workerId, ip, agent) {
    this.track('record', workerId, ip, agent);
  };

  Workers.prototype.trackVerify = function(workerId, ip, agent) {
    this.track('verify', workerId, ip, agent);
  };

  Workers.prototype.addSubmission = function(workerId, cb) {
    let f = ff(() => {
      this.getDB(f());
    },

      db => {
        db.collection(this.name).findOneAndUpdate(
          { workerId: workerId },
          { $inc : { submissionsRecord: 1 } },
          { returnOriginal: false}, f());
      }).onComplete(cb);
  };

  Workers.prototype.create = function(cb) {
    let f = ff(() => {
      this.getDB(f());
    },

      db => {
        db.createCollection(this.name, f.wait());
        f.pass(db);
      },

      db => {
        db.command({
          collMod: this.name,
          'validator': { '$and': [
            { 'workerId': { '$type': 'string' } },
            { 'joined': { '$type': 'date' } },
            { 'updated': { '$type': 'date' } },

            { 'accessRecord': { '$type': 'int' } },
            { 'accessVerify': { '$type': 'int' } },
            { 'submissionsRecord': { '$type': 'int' } },
            { 'submissionsVerify': { '$type': 'int' } },
            // validate that ips is an array (workaround).
            // see: https://jira.mongodb.org/browse/server-23912
            { 'userAgents.0': { '$exists': true } },
            { 'ips.0': { '$exists': true } },
          ]}
        }, f.wait());
        f.pass(db);
      },

      db => {
        db.collection(this.name).createIndex(
          { workerid: 'text' },
          { unique: true }, f.wait());
      });

    f.onComplete(cb);
  };

  module.exports = new Workers();
})();
