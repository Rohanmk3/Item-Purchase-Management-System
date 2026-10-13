CREATE DATABASE IF NOT EXISTS item_purchase_db;
USE item_purchase_db;

CREATE TABLE IF NOT EXISTS item_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type_name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  purchase_date DATE NOT NULL,
  stock_available INT NOT NULL,
  item_type_id INT NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_stock_not_negative CHECK (stock_available >= 0),
  CONSTRAINT fk_items_type FOREIGN KEY (item_type_id) REFERENCES item_types(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id VARCHAR(30) NOT NULL UNIQUE,
  purchase_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_purchase_item (purchase_id, item_id),
  CONSTRAINT chk_qty_positive CHECK (quantity > 0),
  CONSTRAINT fk_pi_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pi_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Sample data (optional)
INSERT IGNORE INTO item_types (id, type_name) VALUES
  (1, 'Electronics'), (2, 'Furniture'), (3, 'Clothing'), (4, 'Grocery'), (5, 'Stationery');

INSERT INTO items (name, purchase_date, stock_available, item_type_id, active)
SELECT * FROM (
  SELECT 'Laptop' AS name, '2026-08-01' AS d, 10 AS s, 1 AS t, 1 AS a
  UNION ALL SELECT 'Mouse', '2026-08-01', 20, 1, 1
  UNION ALL SELECT 'Chair', '2026-08-02', 15, 2, 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM items);
