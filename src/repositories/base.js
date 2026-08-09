'use strict';

const db = require('../config/db');

/** Permite usar o mesmo repositorio dentro ou fora de uma transacao. */
const run = (conn) => conn || db;

module.exports = { run };
