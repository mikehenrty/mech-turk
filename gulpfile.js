var gulp = require('gulp');
var nodemon = require('gulp-nodemon');
var jshint = require('gulp-jshint');
var shell = require('gulp-shell');
var path = require('path');

const PATH_JS = __dirname + '/pub/js/';
const PATH_SERVER = __dirname + '/server/';
const CONFIG_FILE = __dirname + '/config.json';

gulp.task('npm-install', shell.task(['npm install']));

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
  // command comes in --arg form.
  switch (process.argv[3]) {
    case '--add':
      return mechturk.add();
      break;

    case '--list':
    default:
      return mechturk.list();
      break;
  }
});

gulp.task('default', ['lint', 'watch', 'listen']);
