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

  module.exports = {
    Double: mongo.Double,

    getConfig: function(cb) {
      jsonfile.readFile(CONFIG_FILE, function(err, config) {
        if (err) {
          cb(err);
          return;
        }

        cb(null, config);
      });
    },

    getDB: function(cb) {
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
    },

    disconnect: function() {
      if (db) { db.close(); }
    },
  };
})();
