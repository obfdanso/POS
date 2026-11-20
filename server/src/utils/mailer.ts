import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

let transport: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options> | undefined

/** Email is optional: it is on only when an SMTP server is configured. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM)
}

function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      // Port 465 uses TLS from the start; others upgrade with STARTTLS
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Our messages never attach local files or fetch URLs
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  }
  return transport
}

/** Sends one message ({ to, subject, html, text }) from MAIL_FROM. */
export async function sendMail(message: SendMailOptions) {
  return getTransport().sendMail({ from: process.env.MAIL_FROM, ...message })
}
