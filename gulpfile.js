(function() {
  'use strict';

  let gulp = require('gulp');
  let shell = require('gulp-shell');
  let path = require('path');

  const PATH_JS = __dirname + '/pub/js/';
  const PATH_SERVER = __dirname + '/server/';
  const PATH_UPLOAD = __dirname + '/server/upload/';
  const CONFIG_FILE = __dirname + '/config.json';
  const APP_NAME = 'mechturk';

  gulp.task('npm-install', shell.task(['npm install']));

  gulp.task('clean', shell.task([`git clean -idx ${PATH_UPLOAD}`]));

  gulp.task('sync', shell.task(['./bin/sync']));

  gulp.task('listen', () => {
    require('gulp-nodemon')({
      script: 'server/server.js',
      // Use [c] here to workaround nodemon bug #951
      watch: ['server', '[c]onfig.json'],
    });
  });

  gulp.task('lint', () => {
    let jshint = require('gulp-jshint');
    let lintPaths = [
      path.join(PATH_JS, '/**/*.js'),
      path.join(PATH_SERVER, '**/*.js'),
      'gulpfile.js'
    ];
    let task = gulp.src(lintPaths);
    return task.pipe(jshint()).pipe(jshint.reporter('default'));
  });

  gulp.task('watch', () => {
    let watchPaths = [
      CONFIG_FILE,
      PATH_JS + '/**/*.js',
      PATH_SERVER + '/**/*.js',
      'gulpfile.js'
    ];
    gulp.watch(watchPaths, ['lint']);
    gulp.watch('package.json', ['npm-install']);
  });

  gulp.task('deploy', ['npm-install', 'lint'], (done) => {
    let pm2 = require('pm2');
    let ff = require('ff');
    let f = ff(() => {
      pm2.connect(f.wait());
    }, () => {
      require('jsonfile').readFile(CONFIG_FILE, f());
      pm2.stop(APP_NAME, f.waitPlain());
    }, (config) => {
      pm2.start({
        name: APP_NAME,
        script: "server/server.js",
        output: config.logfile || "log.txt",
        error: config.logfile || "log.txt",
      }, f());
    }).onComplete((err) => {
      if (err) {
        console.log('prod error', err);
      }
      pm2.disconnect();
      done();
    });
  });

  gulp.task('local', ['lint', 'watch']);

  gulp.task('default', ['lint', 'watch', 'listen']);
})();
