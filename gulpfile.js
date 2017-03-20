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

gulp.task('default', ['lint', 'watch', 'listen']);
