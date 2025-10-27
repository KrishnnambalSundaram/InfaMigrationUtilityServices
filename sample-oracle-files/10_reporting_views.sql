-- Views for Reporting
-- Sample Oracle views for business intelligence

CREATE OR REPLACE VIEW v_customer_summary AS
SELECT 
    c.customer_id,
    c.customer_name,
    c.email,
    c.phone_number,
    COUNT(o.order_id) as total_orders,
    NVL(SUM(o.total_amount), 0) as total_spent,
    NVL(AVG(o.total_amount), 0) as avg_order_value,
    MAX(o.order_date) as last_order_date,
    MIN(o.order_date) as first_order_date
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name, c.email, c.phone_number;

CREATE OR REPLACE VIEW v_product_performance AS
SELECT 
    p.product_id,
    p.product_name,
    p.price,
    c.category_name,
    NVL(SUM(oi.quantity), 0) as total_quantity_sold,
    NVL(SUM(oi.quantity * oi.unit_price), 0) as total_revenue,
    NVL(AVG(oi.unit_price), p.price) as avg_selling_price,
    NVL(i.stock_quantity, 0) as current_stock
FROM products p
LEFT JOIN categories c ON p.category_id = c.category_id
LEFT JOIN order_items oi ON p.product_id = oi.product_id
LEFT JOIN inventory i ON p.product_id = i.product_id
GROUP BY p.product_id, p.product_name, p.price, c.category_name, i.stock_quantity;

CREATE OR REPLACE VIEW v_monthly_sales AS
SELECT 
    EXTRACT(YEAR FROM order_date) as sales_year,
    EXTRACT(MONTH FROM order_date) as sales_month,
    COUNT(*) as total_orders,
    SUM(total_amount) as total_revenue,
    AVG(total_amount) as avg_order_value,
    COUNT(DISTINCT customer_id) as unique_customers
FROM orders
WHERE status = 'COMPLETED'
GROUP BY EXTRACT(YEAR FROM order_date), EXTRACT(MONTH FROM order_date)
ORDER BY sales_year DESC, sales_month DESC;

CREATE OR REPLACE VIEW v_top_customers AS
SELECT 
    c.customer_id,
    c.customer_name,
    c.email,
    COUNT(o.order_id) as order_count,
    SUM(o.total_amount) as total_spent,
    RANK() OVER (ORDER BY SUM(o.total_amount) DESC) as customer_rank
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
WHERE o.status = 'COMPLETED'
GROUP BY c.customer_id, c.customer_name, c.email;

CREATE OR REPLACE VIEW v_inventory_status AS
SELECT 
    p.product_id,
    p.product_name,
    c.category_name,
    NVL(i.stock_quantity, 0) as current_stock,
    CASE 
        WHEN NVL(i.stock_quantity, 0) = 0 THEN 'OUT_OF_STOCK'
        WHEN NVL(i.stock_quantity, 0) <= 10 THEN 'LOW_STOCK'
        WHEN NVL(i.stock_quantity, 0) <= 50 THEN 'MEDIUM_STOCK'
        ELSE 'HIGH_STOCK'
    END as stock_status,
    p.price,
    NVL(i.last_updated, p.created_date) as last_updated
FROM products p
LEFT JOIN categories c ON p.category_id = c.category_id
LEFT JOIN inventory i ON p.product_id = i.product_id;

CREATE OR REPLACE VIEW v_order_details AS
SELECT 
    o.order_id,
    o.order_date,
    o.status,
    o.total_amount,
    c.customer_name,
    c.email as customer_email,
    COUNT(oi.order_item_id) as item_count,
    SUM(oi.quantity) as total_quantity
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
LEFT JOIN order_items oi ON o.order_id = oi.order_id
GROUP BY o.order_id, o.order_date, o.status, o.total_amount, c.customer_name, c.email;
