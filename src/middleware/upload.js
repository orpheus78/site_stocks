'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');

fs.mkdirSync(env.uploads.dir, { recursive: true });

const EXTENSOES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, env.uploads.dir),
  filename: (req, file, cb) => {
    // Nome aleatorio: evita colisoes e path traversal via nome original.
    const nome = crypto.randomBytes(16).toString('hex') + (EXTENSOES[file.mimetype] || '');
    cb(null, nome);
  }
});

const uploadImagem = multer({
  storage,
  limits: { fileSize: env.uploads.maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!env.uploads.mimeTypes.includes(file.mimetype)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'imagem'));
    }
    cb(null, true);
  }
}).single('imagem');

/** Wrapper que converte erros do multer em mensagens de negocio. */
function uploadArtigo(req, res, next) {
  uploadImagem(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const mensagem =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Imagem demasiado grande (max ${Math.round(env.uploads.maxBytes / 1024 / 1024)}MB).`
          : 'Ficheiro invalido. Apenas JPEG, PNG ou WEBP.';
      req.uploadErro = mensagem;
      return next();
    }
    return next(err);
  });
}

function removerImagem(nomeFicheiro) {
  if (!nomeFicheiro) return;
  const alvo = path.join(env.uploads.dir, path.basename(nomeFicheiro));
  fs.promises.unlink(alvo).catch(() => {});
}

module.exports = { uploadArtigo, removerImagem };
