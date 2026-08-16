'use strict';

/**
 * Suporte a layout para EJS sem dependencias extra:
 * a view e renderizada para string e injetada em `views/layouts/main.ejs`.
 * Para saltar o layout (ex.: um fragmento parcial) passar `layout: false`.
 */
function layout(req, res, next) {
  const render = res.render.bind(res);

  res.render = function renderComLayout(view, options = {}, callback) {
    if (typeof options === 'function') return render(view, {}, options);
    if (callback || options.layout === false) return render(view, options, callback);

    render(view, options, (err, html) => {
      if (err) return next(err);
      render('layouts/main', { ...options, body: html, layout: false }, (errLayout, pagina) => {
        if (errLayout) return next(errLayout);
        res.send(pagina);
      });
    });
  };

  next();
}

module.exports = { layout };
