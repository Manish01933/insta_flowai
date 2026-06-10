/**
 * Email Service
 * Handles email delivery via SendGrid
 */

import sgMail from '@sendgrid/mail';
import config from '../config/environment';
import logger from '../config/logger';

// Initialize SendGrid
if (config.sendgridApiKey) {
  sgMail.setApiKey(config.sendgridApiKey);
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    type?: string;
  }>;
}

/**
 * Send a generic email
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    if (!config.sendgridApiKey) {
      logger.warn('SendGrid API key not configured, email not sent', {
        to: options.to,
        subject: options.subject,
      });
      return false;
    }

    const msg = {
      to: options.to,
      from: config.sendgridFromEmail,
      subject: options.subject,
      html: options.html,
      text: options.text || '',
    } as any;

    if (options.attachments) {
      msg.attachments = options.attachments;
    }

    await sgMail.send(msg);

    logger.info(`Email sent successfully`, {
      to: options.to,
      subject: options.subject,
    });

    return true;
  } catch (error: any) {
    logger.error(`Failed to send email: ${error.message}`, {
      to: options.to,
      subject: options.subject,
      error: error.response?.body || error.stack,
    });

    // Return false instead of throwing so it can be retried
    return false;
  }
}

/**
 * Send invoice email
 */
export async function sendInvoiceEmail(
  userEmail: string,
  userName: string,
  invoiceData: {
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    amount: number;
    currency: string;
    planName: string;
  },
  pdfAttachment?: Buffer
): Promise<boolean> {
  const subject = `Invoice for ${config.companyName} Subscription`;

  const htmlContent = generateInvoiceEmailTemplate({
    userName,
    invoiceNumber: invoiceData.invoiceNumber,
    issueDate: invoiceData.issueDate,
    dueDate: invoiceData.dueDate,
    amount: invoiceData.amount,
    currency: invoiceData.currency,
    planName: invoiceData.planName,
  });

  const textContent = generateInvoiceEmailText({
    userName,
    invoiceNumber: invoiceData.invoiceNumber,
    issueDate: invoiceData.issueDate,
    dueDate: invoiceData.dueDate,
    amount: invoiceData.amount,
    currency: invoiceData.currency,
    planName: invoiceData.planName,
  });

  const attachments = pdfAttachment
    ? [
        {
          filename: `${invoiceData.invoiceNumber}.pdf`,
          content: pdfAttachment,
          type: 'application/pdf',
        },
      ]
    : undefined;

  return sendEmail({
    to: userEmail,
    subject,
    html: htmlContent,
    text: textContent,
    attachments,
  });
}

/**
 * Send payment confirmation email
 */
export async function sendPaymentConfirmationEmail(
  userEmail: string,
  userName: string,
  paymentData: {
    paymentId: string;
    amount: number;
    currency: string;
    planName: string;
    paymentMethod: string;
  }
): Promise<boolean> {
  const subject = `Payment Confirmation - ${config.companyName}`;

  const htmlContent = generatePaymentConfirmationTemplate({
    userName,
    ...paymentData,
  });

  const textContent = generatePaymentConfirmationText({
    userName,
    ...paymentData,
  });

  return sendEmail({
    to: userEmail,
    subject,
    html: htmlContent,
    text: textContent,
  });
}

/**
 * Generate invoice email HTML template
 */
function generateInvoiceEmailTemplate(data: {
  userName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  planName: string;
}): string {
  const { currency } = data;
  const currencySymbol = currency === 'INR' ? '₹' : '$';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 2px solid #007bff;
      padding-bottom: 20px;
    }
    .header h1 {
      margin: 0;
      color: #007bff;
      font-size: 28px;
    }
    .company-info {
      text-align: center;
      color: #666;
      font-size: 14px;
      margin-top: 10px;
    }
    .invoice-details {
      background: white;
      padding: 20px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #eee;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
    }
    .amount-section {
      background: #f0f7ff;
      padding: 20px;
      border-radius: 4px;
      margin: 20px 0;
      text-align: right;
    }
    .amount-label {
      font-size: 14px;
      color: #666;
      margin-bottom: 5px;
    }
    .amount-value {
      font-size: 32px;
      font-weight: bold;
      color: #007bff;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
    .support-info {
      background: #f0f7ff;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
      text-align: center;
    }
    .support-info a {
      color: #007bff;
      text-decoration: none;
    }
    .cta-button {
      display: inline-block;
      background: #007bff;
      color: white;
      padding: 12px 30px;
      border-radius: 4px;
      text-decoration: none;
      margin-top: 20px;
      font-weight: 600;
    }
    .cta-button:hover {
      background: #0056b3;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Invoice</h1>
      <div class="company-info">
        <strong>${config.companyName}</strong>
      </div>
    </div>

    <p>Dear ${data.userName},</p>

    <p>Thank you for choosing ${config.companyName}! We're excited to have you as a valued customer.</p>

    <div class="invoice-details">
      <div class="detail-row">
        <span class="detail-label">Invoice Number:</span>
        <span class="detail-value">${data.invoiceNumber}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Issue Date:</span>
        <span class="detail-value">${data.issueDate}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Due Date:</span>
        <span class="detail-value">${data.dueDate}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Subscription Plan:</span>
        <span class="detail-value">${data.planName}</span>
      </div>
    </div>

    <div class="amount-section">
      <div class="amount-label">Total Amount</div>
      <div class="amount-value">${currencySymbol}${data.amount.toLocaleString()}</div>
    </div>

    <div class="support-info">
      <p><strong>Need help?</strong></p>
      <p>If you have any questions about this invoice, please don't hesitate to contact us.</p>
      <p>
        <a href="mailto:${config.companyEmail}">${config.companyEmail}</a>
      </p>
    </div>

    <p style="text-align: center;">
      <a href="${config.companyWebsite}" class="cta-button">View Dashboard</a>
    </p>

    <div class="footer">
      <p>© ${new Date().getFullYear()} ${config.companyName}. All rights reserved.</p>
      <p>This is an automated email. Please do not reply directly to this message.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate invoice email text content
 */
function generateInvoiceEmailText(data: {
  userName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  amount: number;
  currency: string;
  planName: string;
}): string {
  const { currency } = data;
  const currencySymbol = currency === 'INR' ? '₹' : '$';

  return `
Dear ${data.userName},

Thank you for choosing ${config.companyName}! We're excited to have you as a valued customer.

INVOICE DETAILS:
Invoice Number: ${data.invoiceNumber}
Issue Date: ${data.issueDate}
Due Date: ${data.dueDate}
Subscription Plan: ${data.planName}

TOTAL AMOUNT: ${currencySymbol}${data.amount.toLocaleString()}

If you have any questions about this invoice, please contact us:
Email: ${config.companyEmail}

© ${new Date().getFullYear()} ${config.companyName}. All rights reserved.
  `;
}

/**
 * Generate payment confirmation email template
 */
function generatePaymentConfirmationTemplate(data: {
  userName: string;
  paymentId: string;
  amount: number;
  currency: string;
  planName: string;
  paymentMethod: string;
}): string {
  const { currency } = data;
  const currencySymbol = currency === 'INR' ? '₹' : '$';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Confirmation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      background: #f9f9f9;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .success-header {
      background: #28a745;
      color: white;
      padding: 20px;
      border-radius: 4px;
      text-align: center;
      margin-bottom: 20px;
    }
    .success-header h1 {
      margin: 0;
      font-size: 24px;
    }
    .details {
      background: white;
      padding: 20px;
      border-radius: 4px;
      margin-bottom: 20px;
    }
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #eee;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      font-weight: 600;
      color: #555;
    }
    .detail-value {
      color: #333;
    }
    .footer {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-header">
      <h1>✓ Payment Successful</h1>
    </div>

    <p>Dear ${data.userName},</p>

    <p>Your payment has been processed successfully. Your subscription is now active!</p>

    <div class="details">
      <div class="detail-row">
        <span class="detail-label">Payment ID:</span>
        <span class="detail-value">${data.paymentId}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Amount:</span>
        <span class="detail-value">${currencySymbol}${data.amount.toLocaleString()}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Plan:</span>
        <span class="detail-value">${data.planName}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Payment Method:</span>
        <span class="detail-value">${data.paymentMethod}</span>
      </div>
    </div>

    <p>Thank you for your subscription! You can now access all the features of your plan.</p>

    <div class="footer">
      <p>© ${new Date().getFullYear()} ${config.companyName}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate payment confirmation text content
 */
function generatePaymentConfirmationText(data: {
  userName: string;
  paymentId: string;
  amount: number;
  currency: string;
  planName: string;
  paymentMethod: string;
}): string {
  const { currency } = data;
  const currencySymbol = currency === 'INR' ? '₹' : '$';

  return `
Dear ${data.userName},

Your payment has been processed successfully. Your subscription is now active!

PAYMENT DETAILS:
Payment ID: ${data.paymentId}
Amount: ${currencySymbol}${data.amount.toLocaleString()}
Plan: ${data.planName}
Payment Method: ${data.paymentMethod}

Thank you for your subscription! You can now access all the features of your plan.

© ${new Date().getFullYear()} ${config.companyName}. All rights reserved.
  `;
}

export default {
  sendEmail,
  sendInvoiceEmail,
  sendPaymentConfirmationEmail,
};
