-- DDL: base tables
CREATE TABLE customers (
  customer_id NUMBER PRIMARY KEY,
  customer_name VARCHAR2(100) NOT NULL,
  email VARCHAR2(100),
  status VARCHAR2(20) DEFAULT 'ACTIVE',
  created_date DATE DEFAULT SYSDATE
);

CREATE TABLE orders (
  order_id NUMBER PRIMARY KEY,
  customer_id NUMBER NOT NULL,
  amount NUMBER(12,2) NOT NULL,
  order_date DATE DEFAULT SYSDATE,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
);

-- Sequence
CREATE SEQUENCE orders_seq START WITH 1000 INCREMENT BY 1 NOCACHE NOCYCLE;

-- View
CREATE OR REPLACE VIEW v_customer_order_totals AS
SELECT c.customer_id,
       c.customer_name,
       COALESCE(SUM(o.amount), 0) AS total_spent,
       COUNT(o.order_id) AS total_orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id, c.customer_name;

-- Function
CREATE OR REPLACE FUNCTION calculate_order_total(p_customer_id IN NUMBER)
RETURN NUMBER
AS
  v_total NUMBER := 0;
BEGIN
  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM orders
   WHERE customer_id = p_customer_id;
  RETURN v_total;
END calculate_order_total;
/

-- Procedure with cursor, loop, error handling
CREATE OR REPLACE PROCEDURE refresh_customer_totals
AS
  CURSOR c_customers IS
    SELECT customer_id FROM customers WHERE status = 'ACTIVE';
  v_id NUMBER;
  v_total NUMBER;
BEGIN
  OPEN c_customers;
  LOOP
    FETCH c_customers INTO v_id;
    EXIT WHEN c_customers%NOTFOUND;
    v_total := calculate_order_total(v_id);
    -- simulate write to an audit table (commented out)
    -- INSERT INTO customer_audit(customer_id, total_amount, snapshot_time) VALUES (v_id, v_total, SYSDATE);
  END LOOP;
  CLOSE c_customers;
EXCEPTION
  WHEN OTHERS THEN
    -- basic exception handling
    NULL;
END refresh_customer_totals;
/

