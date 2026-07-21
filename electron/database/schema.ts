export const initialSchema = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT,
  phone TEXT,
  email TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS raw_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category_id INTEGER,
  unit TEXT NOT NULL,
  current_stock REAL NOT NULL DEFAULT 0,
  minimum_stock REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id),
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS finished_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category_id INTEGER,
  production_unit TEXT NOT NULL DEFAULT 'buc',
  current_stock REAL NOT NULL DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_product_id INTEGER UNIQUE,
  batch_size REAL NOT NULL DEFAULT 1,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(finished_product_id) REFERENCES finished_products(id)
);

CREATE TABLE IF NOT EXISTS recipe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER,
  raw_material_id INTEGER,
  quantity REAL NOT NULL,
  FOREIGN KEY(recipe_id) REFERENCES recipes(id),
  FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
);

CREATE TABLE IF NOT EXISTS productions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_product_id INTEGER,
  quantity_produced REAL NOT NULL,
  production_date DATE NOT NULL,
  shift TEXT,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'confirmed',
  FOREIGN KEY(finished_product_id) REFERENCES finished_products(id)
);

CREATE TABLE IF NOT EXISTS stock_receptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_date DATE NOT NULL,
  supplier_id INTEGER,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS reception_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id INTEGER,
  raw_material_id INTEGER,
  quantity REAL NOT NULL,
  unit_price REAL,
  FOREIGN KEY(reception_id) REFERENCES stock_receptions(id),
  FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id INTEGER,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id INTEGER,
  quantity_delta REAL NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by TEXT,
  adjusted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(raw_material_id) REFERENCES raw_materials(id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS finished_product_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finished_product_id INTEGER,
  movement_type TEXT NOT NULL,
  quantity REAL NOT NULL,
  stock_before REAL NOT NULL,
  stock_after REAL NOT NULL,
  reference_type TEXT,
  reference_id INTEGER,
  notes TEXT,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(finished_product_id) REFERENCES finished_products(id)
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  car_details TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  role TEXT,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date DATE NOT NULL UNIQUE,
  opening_balance REAL NOT NULL DEFAULT 0,
  closing_balance REAL,
  is_closed BOOLEAN DEFAULT 0,
  closed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_day_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  reference_id INTEGER,
  reference_name TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(cash_day_id) REFERENCES cash_days(id)
);

CREATE TABLE IF NOT EXISTS cash_transaction_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL,
  finished_product_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  FOREIGN KEY(transaction_id) REFERENCES cash_transactions(id),
  FOREIGN KEY(finished_product_id) REFERENCES finished_products(id)
);
`;

export const seedData = `
INSERT OR IGNORE INTO categories (name, type) VALUES ('Făinuri', 'raw_material');
INSERT OR IGNORE INTO categories (name, type) VALUES ('Lactate & Ouă', 'raw_material');
INSERT OR IGNORE INTO categories (name, type) VALUES ('Zahăr & Diverse', 'raw_material');
INSERT OR IGNORE INTO categories (name, type) VALUES ('Ambalaje', 'raw_material');
INSERT OR IGNORE INTO categories (name, type) VALUES ('Patiserie Dulce', 'finished_product');
INSERT OR IGNORE INTO categories (name, type) VALUES ('Patiserie Sărată', 'finished_product');
`;
