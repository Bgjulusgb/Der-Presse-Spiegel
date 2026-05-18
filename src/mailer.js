'use strict';

const fs = require('fs');
const nodemailer = require('nodemailer');
const logger = require('./logger');

function buildTransport() {
  if (!process.env.SMTP_HOST) {
    logger.warn('SMTP nicht konfiguriert (.env), E-Mail-Versand deaktiviert');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
}

async function sendMail({ to, subject, html, attachments }) {
  const transport = buildTransport();
  if (!transport) return null;
  if (!to || to.length === 0) {
    logger.warn('Keine Empfaenger fuer E-Mail');
    return null;
  }
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: Array.isArray(to) ? to.join(',') : to,
      subject,
      html,
      attachments: attachments || []
    });
    logger.info(`E-Mail versendet: ${subject} → ${to}`);
    return info;
  } catch (err) {
    logger.error('E-Mail-Versand fehlgeschlagen', { error: err.message });
    return null;
  }
}

async function sendReportMail({ recipients, subject, htmlReportPath, pdfReportPath, summary }) {
  const html = `
    <h2>${subject}</h2>
    <p>Anbei der aktuelle Pressespiegel.</p>
    <ul>
      <li>Artikel gesamt: <strong>${summary.total || 0}</strong></li>
      <li>Sehr relevant: <strong>${summary.veryRelevant || 0}</strong></li>
      <li>Positive Stimmen: <strong>${summary.positive || 0}</strong></li>
      <li>Negative Stimmen: <strong>${summary.negative || 0}</strong></li>
    </ul>
    <p>Vollstaendiger Report im Anhang.</p>
  `;
  const attachments = [];
  if (htmlReportPath && fs.existsSync(htmlReportPath)) {
    attachments.push({ filename: 'pressespiegel.html', path: htmlReportPath });
  }
  if (pdfReportPath && fs.existsSync(pdfReportPath)) {
    attachments.push({ filename: 'pressespiegel.pdf', path: pdfReportPath });
  }
  return sendMail({ to: recipients, subject, html, attachments });
}

async function sendAlertMail({ recipients, articles }) {
  if (!articles.length) return null;
  const subject = `[Pressespiegel-Alert] ${articles.length} hochrelevante Artikel`;
  const html = `
    <h2>${subject}</h2>
    <p>Folgende hochrelevanten Artikel wurden gefunden:</p>
    <ul>
      ${articles.map(a => `
        <li>
          <strong><a href="${a.url}">${a.title}</a></strong><br>
          ${a.source || ''} · Score ${a.relevance_score} · Sentiment: ${a.sentiment || 'neutral'}
        </li>
      `).join('')}
    </ul>
  `;
  return sendMail({ to: recipients, subject, html });
}

module.exports = { sendMail, sendReportMail, sendAlertMail };
