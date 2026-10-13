# Item & Purchase Management System

Node.js + Express + MySQL, with a plain HTML/CSS/JS frontend served by Express (one command runs everything).

## Prerequisites
- Node.js 18 or newer
- MySQL 8.0.16 or newer (needed for CHECK constraints)

## Setup

1. **Create the database and tables** (also inserts sample item types and 3 sample items):
   ```bash
   mysql -u root -p < schema.sql
   ```
2. **Configure credentials**: copy `.env.example` to `.env` and edit it:
   ```
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=item_purchase_db
   PORT=3000
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Start the app** (backend + frontend together):
   ```bash
   npm start
   ```
5. Open http://localhost:3000

## Project structure
```
server.js          Express API, validation, transactions
schema.sql         Tables, keys, sample data
public/index.html  Frontend (forms, tables, CSS, JS)
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET / POST | `/api/item-types` | List / create item types |
| PUT / DELETE | `/api/item-types/:id` | Rename / delete (blocked if items use it) |
| GET / POST | `/api/items` | List (JOIN with item type) / create |
| GET / PUT / DELETE | `/api/items/:id` | View / update / delete (blocked if used in a purchase) |
| GET / POST | `/api/purchases` | List / create purchase (transaction) |
| GET / PUT | `/api/purchases/:id` | View details (JOINs) / update with stock adjustment |

There is **no** DELETE purchase route, and the UI has no delete button for purchases.

### Examples
```bash
# create an item
curl -X POST localhost:3000/api/items -H "Content-Type: application/json" \
  -d '{"name":"Keyboard","item_type_id":1,"purchase_date":"2026-08-25","stock_available":30,"active":true}'

# create a purchase (order id PO-00001 is generated)
curl -X POST localhost:3000/api/purchases -H "Content-Type: application/json" \
  -d '{"purchase_date":"2026-08-25","items":[{"item_id":1,"quantity":2},{"item_id":2,"quantity":5}]}'

# update a purchase: stock changes by the difference in quantity
curl -X PUT localhost:3000/api/purchases/1 -H "Content-Type: application/json" \
  -d '{"purchase_date":"2026-08-25","items":[{"item_id":1,"quantity":5},{"item_id":2,"quantity":5}]}'

# view purchase details (by numeric id or order id)
curl localhost:3000/api/purchases/PO-00001
```

### Errors
| Case | Status | Message |
|---|---|---|
| Missing name / bad date / quantity <= 0 / no items | 400 | e.g. `Item name is required`, `Quantity must be greater than zero` |
| Invalid item type | 400 | `Invalid item type` |
| Invalid ID | 400 | `Invalid ID` |
| Item / purchase not found | 404 | `Item not found` |
| Inactive item | 409 | `<name>: Item is inactive and cannot be purchased` |
| Not enough stock | 409 | `Insufficient stock for <name>; available: N` |
| Delete item used in purchases | 409 | `...Mark it inactive instead.` |
| Unexpected / database error | 500 | `Something went wrong. Please try again.` (details only in server log) |

## How the key rules are done
- **Validation** is on the backend (`server.js`); the frontend only helps.
- **Transactions**: creating or updating a purchase runs in one MySQL transaction; any failure rolls everything back.
- **No negative stock**: stock is checked inside the transaction on locked rows (`SELECT ... FOR UPDATE`), plus a `CHECK (stock_available >= 0)` in the database.
- **Purchase update**: stock changes by `new quantity - old quantity` per item (3 -> 5 deducts 2, 5 -> 2 returns 3). Removing a line returns its quantity.
- **Duplicate items in one order** are rejected by the API (the UI merges them into one line).
- **JOINs**: item + item type (`GET /api/items`) and purchase + purchase_items + items + item_types (`GET /api/purchases/:id`).

## Screenshots
Take these for submission: item list, add item, create purchase, an insufficient-stock error, purchase details, stock view.
