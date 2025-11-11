import Stripe from 'stripe';
import db from '../db';
import dotenv from 'dotenv';
dotenv.config();

const stripe = new Stripe(process.env.STRIPE_API_KEY || '', { apiVersion: '2022-11-15' });

/**
 * Create a PaymentIntent for a local invoice and persist the stripe_payment_intent_id on the invoice row.
 * Assumes local invoices table with: id, organization_id, total_cents, currency, stripe_payment_intent_id, status
 */
export async function createPaymentIntentForInvoice(invoiceId: string) {
  const r = await db.query('SELECT * FROM invoices WHERE id=$1 LIMIT 1', [invoiceId]);
  const invoice = r.rows[0];
  if (!invoice) throw new Error('invoice not found');

  const amount = Math.round((invoice.total || 0) * 100); // cents
  const currency = invoice.currency || 'usd';

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency,
    metadata: { invoiceId },
  });

  // persist pi id
  await db.query('UPDATE invoices SET stripe_payment_intent_id=$1 WHERE id=$2', [paymentIntent.id, invoiceId]);

  return paymentIntent;
}

/**
 * Use Stripe Invoices API if you maintain Stripe customer ids and want to create an actual Stripe Invoice
 * For many flows it's simpler to use PaymentIntent + receipt. This helper focuses on PaymentIntents for MVP.
 */
export async function getPaymentIntentStatus(paymentIntentId: string) {
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return pi;
}

export default stripe;