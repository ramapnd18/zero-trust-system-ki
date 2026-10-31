'use strict';

const { PrismaClient } = require('@prisma/client');

// Satu instance PrismaClient per proses; disconnect saat shutdown.
const prisma = new PrismaClient();

module.exports = prisma;
