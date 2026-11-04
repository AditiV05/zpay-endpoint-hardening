// v1 backward compatibility: clients may send amount or amount_inr.
// If both are sent, amount wins.
function normaliseFields(req, res, next) {
  req.body = req.body || {};

  // v2: remove amount_inr fallback
  if (req.body.amount === undefined && req.body.amount_inr !== undefined) {
    req.body.amount = req.body.amount_inr;
  }

  next();
}

module.exports = { normaliseFields };
