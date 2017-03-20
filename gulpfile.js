var gulp = require('gulp');
var nodemon = require('gulp-nodemon');

gulp.task('listen', () => {
  nodemon({
    script: 'server/server.js',
    // Use [c] here to workaround nodemon bug #951
    watch: ['server', '[c]onfig.json'],
  });
});

gulp.task('default', ['listen']);
