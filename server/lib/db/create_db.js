'use strict';

var mongo = require('./mongo');
var Workers = require('./workers');

var ff = require('ff');

function run(cb) {
  var f = ff(() => {
    Workers.create(f());
  });

  f.onComplete((err) => {
    if (err) { console.error('could not create db', err); }
    mongo.disconnect();
    if (cb) { cb(); }
  });
}

// If this was run from cli, immediately invoke run.
if (require.main === module) {
  run();
} else {
  module.exports = run;
}
