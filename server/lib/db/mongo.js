(function() {
  'use strict';

  let jsonfile = require('jsonfile');
  let ff = require('ff');
  let path = require('path');
  let mongo = require('mongodb');
  let client = mongo.MongoClient;

  let db = null;

  const CONFIG_FILE = path.resolve(__dirname, '../../../config.json');

  function getMongoUrl(user, pass, port, name) {
    return `mongodb://${user}:${pass}@localhost:${port}/${name}`;
  }

  function Mongo() {
  }

  Mongo.Double = mongo.Double;

  Mongo.prototype.getConfig = function(cb) {
    jsonfile.readFile(CONFIG_FILE, function(err, config) {
      if (err) {
        cb(err);
        return;
      }

      cb(null, config);
    });
  };

  Mongo.prototype.getDB = function(cb) {
    if (db) {
      cb(null, db);
      return;
    }

    let f = ff(() => {
      this.getConfig(f());
    }, config => {

      let user = config.DB_USER;
      let pass = config.DB_PASS;
      let port = config.DB_PORT;
      let name = config.DB_NAME;
      let url = getMongoUrl(user, pass, port, name);
      client.connect(url, f());

    }, mongodb => {
      db = mongodb;
      cb(null, db);
    }).onError(e => {
      cb(e);
    });
  };

  Mongo.prototype.getCollection = function(cb) {
    this.getDB((err, db) => {
      cb(err, db && db.collection(this.name));
    });
  };

  Mongo.prototype.count = function(cb) {
    let f = ff(() => {
      this.getCollection(f());
    },
      collection => {
        collection.count(f());
      }).onComplete(cb);
  };

  Mongo.prototype.remove = function(cb) {
    this.getCollection((err, collection) => {
      collection.remove({}, cb);
    });
  };

  Mongo.prototype.destroy = function(cb) {
    let f = ff(() => {
      this.getDB(f());
    },

      db => {
        db.collection(this.name).drop(f());
      });

    f.onComplete(cb);
  };


  Mongo.prototype.disconnect = function() {
    if (db) { db.close(); }
  };

  module.exports = Mongo;

})();
