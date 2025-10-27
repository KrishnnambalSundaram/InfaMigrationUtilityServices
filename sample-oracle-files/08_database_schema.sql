-- Database Schema Creation Scripts
-- Sample Oracle DDL statements

-- Create sequences
CREATE SEQUENCE customer_seq
    START WITH 1000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

CREATE SEQUENCE order_seq
    START WITH 2000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

CREATE SEQUENCE product_seq
    START WITH 3000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

CREATE SEQUENCE audit_seq
    START WITH 4000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

CREATE SEQUENCE activity_seq
    START WITH 5000
    INCREMENT BY 1
    NOCACHE
    NOCYCLE;

-- Create tables
CREATE TABLE customers (
    customer_id NUMBER PRIMARY KEY,
    customer_name VARCHAR2(100) NOT NULL,
    email VARCHAR2(100),
    phone_number VARCHAR2(20),
    address VARCHAR2(200),
    created_date DATE DEFAULT SYSDATE,
    last_updated DATE
);

CREATE TABLE categories (
    category_id NUMBER PRIMARY KEY,
    category_name VARCHAR2(50) NOT NULL,
    description VARCHAR2(200),
    created_date DATE DEFAULT SYSDATE
);

CREATE TABLE products (
    product_id NUMBER PRIMARY KEY,
    product_name VARCHAR2(100) NOT NULL,
    description VARCHAR2(500),
    price NUMBER(10,2) NOT NULL,
    category_id NUMBER,
    created_date DATE DEFAULT SYSDATE,
    last_updated DATE,
    CONSTRAINT fk_product_category FOREIGN KEY (category_id) REFERENCES categories(category_id)
);

CREATE TABLE orders (
    order_id NUMBER PRIMARY KEY,
    customer_id NUMBER NOT NULL,
    order_date DATE DEFAULT SYSDATE,
    status VARCHAR2(20) DEFAULT 'PENDING',
    total_amount NUMBER(10,2),
    last_updated DATE,
    CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE order_items (
    order_item_id NUMBER PRIMARY KEY,
    order_id NUMBER NOT NULL,
    product_id NUMBER NOT NULL,
    quantity NUMBER NOT NULL,
    unit_price NUMBER(10,2) NOT NULL,
    CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(order_id),
    CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE inventory (
    product_id NUMBER PRIMARY KEY,
    stock_quantity NUMBER DEFAULT 0,
    last_updated DATE DEFAULT SYSDATE,
    CONSTRAINT fk_inventory_product FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE inventory_transactions (
    transaction_id NUMBER PRIMARY KEY,
    product_id NUMBER NOT NULL,
    transaction_type VARCHAR2(10) NOT NULL,
    quantity_change NUMBER NOT NULL,
    new_stock NUMBER NOT NULL,
    transaction_date DATE DEFAULT SYSDATE,
    CONSTRAINT fk_trans_product FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE customer_audit_log (
    audit_id NUMBER PRIMARY KEY,
    customer_id NUMBER NOT NULL,
    field_name VARCHAR2(50) NOT NULL,
    old_value VARCHAR2(500),
    new_value VARCHAR2(500),
    changed_by VARCHAR2(50),
    change_date DATE DEFAULT SYSDATE,
    CONSTRAINT fk_audit_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

CREATE TABLE order_activity_log (
    log_id NUMBER PRIMARY KEY,
    order_id NUMBER NOT NULL,
    activity_type VARCHAR2(50) NOT NULL,
    description VARCHAR2(500),
    user_id VARCHAR2(50),
    activity_date DATE DEFAULT SYSDATE,
    CONSTRAINT fk_activity_order FOREIGN KEY (order_id) REFERENCES orders(order_id)
);

CREATE TABLE codes (
    code_id NUMBER PRIMARY KEY,
    code_value VARCHAR2(50) UNIQUE NOT NULL,
    code_type VARCHAR2(20),
    created_date DATE DEFAULT SYSDATE
);

-- Create indexes for performance
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_inventory_transactions_product ON inventory_transactions(product_id);
CREATE INDEX idx_audit_log_customer ON customer_audit_log(customer_id);
CREATE INDEX idx_activity_log_order ON order_activity_log(order_id);
