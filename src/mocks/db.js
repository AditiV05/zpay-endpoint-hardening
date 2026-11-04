// Mocked transaction storage and card processor, held in memory.
const payments = new Map(); // payment id -> payment
const paymentIdByRef = new Map(); // transaction_ref -> payment id
const charges = []; // every card charge, so tests can prove there was no double charge

let nextId = 1;

const db = {
  findPaymentIdByRef(ref) {
    return paymentIdByRef.get(ref);
  },

  // Check and insert run in one synchronous step, so two requests with the
  // same transaction_ref cannot both pass the duplicate check.
  // Returns null when the ref is already taken.
  createPayment({ userId, amount, transactionRef }) {
    if (transactionRef !== undefined && paymentIdByRef.has(transactionRef)) {
      return null;
    }

    const payment = {
      id: `pay_${nextId++}`,
      status: 'succeeded',
      amount,
      currency: 'INR',
      transaction_ref: transactionRef ?? null,
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    payments.set(payment.id, payment);
    if (transactionRef !== undefined) {
      paymentIdByRef.set(transactionRef, payment.id);
    }
    charges.push({ paymentId: payment.id, amount });
    return payment;
  },

  chargeCount() {
    return charges.length;
  },

  reset() {
    payments.clear();
    paymentIdByRef.clear();
    charges.length = 0;
    nextId = 1;
  },
};

module.exports = db;
