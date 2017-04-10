var gulp = require('gulp');
var nodemon = require('gulp-nodemon');
var jshint = require('gulp-jshint');
var shell = require('gulp-shell');
var path = require('path');
var pm2 = require('pm2');
var ff = require('ff');
var jsonfile = require('jsonfile');

const PATH_JS = __dirname + '/pub/js/';
const PATH_SERVER = __dirname + '/server/';
const CONFIG_FILE = __dirname + '/config.json';
const APP_NAME = 'mechturk';

gulp.task('npm-install', shell.task(['npm install']));

gulp.task('clean', shell.task([`git clean -idx ${PATH_SERVER}`]));

gulp.task('listen', () => {
  nodemon({
    script: 'server/server.js',
    // Use [c] here to workaround nodemon bug #951
    watch: ['server', '[c]onfig.json'],
  });
});

gulp.task('lint', () => {
  var lintPaths = [
    path.join(PATH_JS, '/**/*.js'),
    path.join(PATH_SERVER, '**/*.js')
  ];
  var task = gulp.src(lintPaths);
  return task.pipe(jshint()).pipe(jshint.reporter('default'));
});

gulp.task('watch', () => {
  var watchPaths = [
    CONFIG_FILE,
    PATH_JS + '/**/*.js',
    PATH_SERVER + '/**/*.js'
  ];
  gulp.watch(watchPaths, ['lint']);
  gulp.watch('package.json', ['npm-install']);
});

gulp.task('turk', () => {
  var mechturk = require('./server/lib/mechturk.js');
  // trim unwanted dashes '--'.
  var command = process.argv[3] && process.argv[3].substr(2);
  return mechturk.runCommand(command, process.argv[4]);
});

gulp.task('deploy', ['npm-install', 'lint'], (done) => {
  var f = ff(() => {
    pm2.connect(f.wait());
  }, () => {
    jsonfile.readFile(CONFIG_FILE, f());
    pm2.stop(APP_NAME, f.waitPlain());
  }, (config) => {
    pm2.start({
      name: APP_NAME,
      script: "server/server.js",
      output: config.logfile || "log.txt",
      error: config.logfile || "log.txt",
    }, f());
  }).onComplete((err) => {
    err && console.log('prod error', err);
    pm2.disconnect();
    done();
  });
});

gulp.task('default', ['lint', 'watch', 'listen']);
