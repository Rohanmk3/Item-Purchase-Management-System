require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'item_purchase_db',
  dateStrings: true, // return DATE columns as 'YYYY-MM-DD'
  connectionLimit: 10,
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid ID');
  return n;
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : null;
}

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const availability = (stock) =>
  stock === 0 ? 'Out of Stock' : stock <= 5 ? 'Low Stock' : 'In Stock';

// ---------- item types ----------
app.get('/api/item-types', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT id, type_name FROM item_types ORDER BY type_name');
  res.json(rows);
}));

function typeName(body) {
  const name = typeof body.type_name === 'string' ? body.type_name.trim() : '';
  if (!name) throw new HttpError(400, 'Item type name is required');
  if (name.length > 100) throw new HttpError(400, 'Item type name is too long');
  return name;
}

app.post('/api/item-types', wrap(async (req, res) => {
  const name = typeName(req.body);
  const [r] = await pool.query('INSERT INTO item_types (type_name) VALUES (?)', [name]);
  res.status(201).json({ id: r.insertId, type_name: name });
}));

app.put('/api/item-types/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const name = typeName(req.body);
  const [r] = await pool.query('UPDATE item_types SET type_name = ? WHERE id = ?', [name, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Item type not found');
  res.json({ id, type_name: name });
}));

app.delete('/api/item-types/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const [[used]] = await pool.query('SELECT COUNT(*) AS c FROM items WHERE item_type_id = ?', [id]);
  if (used.c > 0) throw new HttpError(409, 'Item type is used by items and cannot be deleted');
  const [r] = await pool.query('DELETE FROM item_types WHERE id = ?', [id]);
  if (!r.affectedRows) throw new HttpError(404, 'Item type not found');
  res.json({ message: 'Item type deleted' });
}));

// ---------- items ----------
// JOIN: item + item type
const ITEM_SELECT = `
  SELECT i.id, i.name, it.type_name, i.item_type_id, i.purchase_date,
         i.stock_available, i.active
  FROM items i
  JOIN item_types it ON i.item_type_id = it.id`;

const shapeItem = (r) => ({
  ...r,
  active: !!r.active,
  availability: availability(r.stock_available),
});

async function validateItem(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new HttpError(400, 'Item name is required');
  if (name.length > 100) throw new HttpError(400, 'Item name is too long');

  if (body.item_type_id === undefined || body.item_type_id === null || body.item_type_id === '')
    throw new HttpError(400, 'Item type is required');
  const typeId = Number(body.item_type_id);
  const [t] = Number.isInteger(typeId)
    ? await pool.query('SELECT id FROM item_types WHERE id = ?', [typeId])
    : [[]];
  if (!t.length) throw new HttpError(400, 'Invalid item type');

  const date = validDate(body.purchase_date);
  if (!date) throw new HttpError(400, 'Purchase date is required and must be a valid date (YYYY-MM-DD)');

  if (body.stock_available === undefined || body.stock_available === null || body.stock_available === '')
    throw new HttpError(400, 'Stock is required');
  const stock = Number(body.stock_available);
  if (!Number.isInteger(stock)) throw new HttpError(400, 'Stock must be a whole number');
  if (stock < 0) throw new HttpError(400, 'Stock cannot be negative');

  let active;
  if (typeof body.active === 'boolean') active = body.active;
  else if (body.active === 0 || body.active === 1) active = !!body.active;
  else throw new HttpError(400, 'Status (active) is required');

  return { name, typeId, date, stock, active };
}

app.get('/api/items', wrap(async (req, res) => {
  const [rows] = await pool.query(ITEM_SELECT + ' ORDER BY i.id');
  res.json(rows.map(shapeItem));
}));

app.get('/api/items/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const [rows] = await pool.query(ITEM_SELECT + ' WHERE i.id = ?', [id]);
  if (!rows.length) throw new HttpError(404, 'Item not found');
  res.json(shapeItem(rows[0]));
}));

app.post('/api/items', wrap(async (req, res) => {
  const v = await validateItem(req.body);
  const [r] = await pool.query(
    'INSERT INTO items (name, purchase_date, stock_available, item_type_id, active) VALUES (?,?,?,?,?)',
    [v.name, v.date, v.stock, v.typeId, v.active ? 1 : 0]
  );
  const [rows] = await pool.query(ITEM_SELECT + ' WHERE i.id = ?', [r.insertId]);
  res.status(201).json(shapeItem(rows[0]));
}));

app.put('/api/items/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const v = await validateItem(req.body);
  const [r] = await pool.query(
    'UPDATE items SET name=?, purchase_date=?, stock_available=?, item_type_id=?, active=? WHERE id=?',
    [v.name, v.date, v.stock, v.typeId, v.active ? 1 : 0, id]
  );
  if (!r.affectedRows) throw new HttpError(404, 'Item not found');
  const [rows] = await pool.query(ITEM_SELECT + ' WHERE i.id = ?', [id]);
  res.json(shapeItem(rows[0]));
}));

app.delete('/api/items/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const [exists] = await pool.query('SELECT id FROM items WHERE id = ?', [id]);
  if (!exists.length) throw new HttpError(404, 'Item not found');
  const [[used]] = await pool.query('SELECT COUNT(*) AS c FROM purchase_items WHERE item_id = ?', [id]);
  if (used.c > 0)
    throw new HttpError(409, 'Item is used in purchase history and cannot be deleted. Mark it inactive instead.');
  await pool.query('DELETE FROM items WHERE id = ?', [id]);
  res.json({ message: 'Item deleted' });
}));

// ---------- purchases ----------
function validatePurchase(body) {
  const date = validDate(body.purchase_date);
  if (!date) throw new HttpError(400, 'Purchase date is required and must be a valid date (YYYY-MM-DD)');
  if (!Array.isArray(body.items) || body.items.length === 0)
    throw new HttpError(400, 'Purchase must contain at least one item');

  const seen = new Set();
  const lines = body.items.map((l) => {
    const itemId = Number(l && l.item_id);
    if (!Number.isInteger(itemId) || itemId <= 0) throw new HttpError(400, 'Invalid item ID in purchase');
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new HttpError(400, 'Quantity must be greater than zero');
    if (seen.has(itemId)) throw new HttpError(400, 'Duplicate item in order; combine it into one line');
    seen.add(itemId);
    return { itemId, qty };
  });
  return { date, lines };
}

// lock the item row so two purchases can't oversell at the same time
async function lockItem(conn, id) {
  const [rows] = await conn.query(
    'SELECT id, name, stock_available, active FROM items WHERE id = ? FOR UPDATE', [id]);
  if (!rows.length) throw new HttpError(404, 'Item not found');
  return rows[0];
}

const insufficient = (item) =>
  new HttpError(409, `Insufficient stock for ${item.name}; available: ${item.stock_available}`);

const insertLines = (conn, purchaseId, lines) =>
  conn.query('INSERT INTO purchase_items (purchase_id, item_id, quantity) VALUES ?',
    [lines.map((l) => [purchaseId, l.itemId, l.qty])]);

// JOIN: purchase + purchase items + items + item types
async function getPurchase(key) {
  const where = /^\d+$/.test(String(key)) ? 'p.id = ?' : 'p.order_id = ?';
  const [rows] = await pool.query(
    `SELECT p.id AS purchase_id, p.order_id, p.purchase_date,
            i.id AS item_id, i.name AS item_name, it.type_name,
            pi.quantity, i.stock_available, i.active
     FROM purchases p
     JOIN purchase_items pi ON p.id = pi.purchase_id
     JOIN items i ON pi.item_id = i.id
     JOIN item_types it ON i.item_type_id = it.id
     WHERE ${where}
     ORDER BY pi.id`, [key]);
  if (!rows.length) throw new HttpError(404, 'Purchase not found');
  return {
    id: rows[0].purchase_id,
    order_id: rows[0].order_id,
    purchase_date: rows[0].purchase_date,
    items: rows.map((r) => ({
      item_id: r.item_id, item_name: r.item_name, type_name: r.type_name,
      quantity: r.quantity, stock_available: r.stock_available, active: !!r.active,
    })),
  };
}

app.get('/api/purchases', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.order_id, p.purchase_date,
            COUNT(pi.id) AS item_count, SUM(pi.quantity) AS total_quantity
     FROM purchases p
     JOIN purchase_items pi ON p.id = pi.purchase_id
     GROUP BY p.id ORDER BY p.id DESC`);
  res.json(rows.map((r) => ({ ...r, total_quantity: Number(r.total_quantity) })));
}));

app.get('/api/purchases/:id', wrap(async (req, res) => {
  res.json(await getPurchase(req.params.id));
}));

app.post('/api/purchases', wrap(async (req, res) => {
  const { date, lines } = validatePurchase(req.body);

  const purchaseId = await withTransaction(async (conn) => {
    // 1. validate all items + stock (sorted by id to avoid deadlocks)
    const sorted = [...lines].sort((a, b) => a.itemId - b.itemId);
    for (const l of sorted) {
      const item = await lockItem(conn, l.itemId);
      if (!item.active) throw new HttpError(409, `${item.name}: Item is inactive and cannot be purchased`);
      if (l.qty > item.stock_available) throw insufficient(item);
    }
    // 2. insert purchase (order id is generated from the row id: PO-00001)
    const tmp = 'TMP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const [r] = await conn.query('INSERT INTO purchases (order_id, purchase_date) VALUES (?,?)', [tmp, date]);
    const orderId = 'PO-' + String(r.insertId).padStart(5, '0');
    await conn.query('UPDATE purchases SET order_id = ? WHERE id = ?', [orderId, r.insertId]);
    // 3. insert purchase items
    await insertLines(conn, r.insertId, lines);
    // 4. deduct stock
    for (const l of lines)
      await conn.query('UPDATE items SET stock_available = stock_available - ? WHERE id = ?', [l.qty, l.itemId]);
    return r.insertId;
  });

  res.status(201).json(await getPurchase(purchaseId));
}));

app.put('/api/purchases/:id', wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const { date, lines } = validatePurchase(req.body);

  await withTransaction(async (conn) => {
    const [p] = await conn.query('SELECT id FROM purchases WHERE id = ? FOR UPDATE', [id]);
    if (!p.length) throw new HttpError(404, 'Purchase not found');

    const [oldRows] = await conn.query('SELECT item_id, quantity FROM purchase_items WHERE purchase_id = ?', [id]);
    const oldQty = new Map(oldRows.map((r) => [r.item_id, r.quantity]));
    const newQty = new Map(lines.map((l) => [l.itemId, l.qty]));
    const itemIds = [...new Set([...oldQty.keys(), ...newQty.keys()])].sort((a, b) => a - b);

    // stock changes by the difference between new and old quantity
    for (const itemId of itemIds) {
      const item = await lockItem(conn, itemId);
      const diff = (newQty.get(itemId) || 0) - (oldQty.get(itemId) || 0);
      if (diff > 0) {
        if (!item.active) throw new HttpError(409, `${item.name}: Item is inactive and cannot be purchased`);
        if (diff > item.stock_available) throw insufficient(item);
      }
      if (diff !== 0)
        await conn.query('UPDATE items SET stock_available = stock_available - ? WHERE id = ?', [diff, itemId]);
    }

    await conn.query('UPDATE purchases SET purchase_date = ? WHERE id = ?', [date, id]);
    await conn.query('DELETE FROM purchase_items WHERE purchase_id = ?', [id]); // lines only, never the purchase
    await insertLines(conn, id, lines);
  });

  res.json(await getPurchase(id));
}));

// NOTE: there is intentionally no DELETE /api/purchases route.

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON request' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Duplicate value already exists' });
  if (err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'Record is in use and cannot be removed' });
  console.error(err); // details stay in the server log only
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));
