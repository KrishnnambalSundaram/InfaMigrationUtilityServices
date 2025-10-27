-- Financial Reporting Functions
-- Sample Oracle PL/SQL for financial calculations

CREATE OR REPLACE FUNCTION calculate_monthly_revenue(
    p_year IN NUMBER,
    p_month IN NUMBER
) RETURN NUMBER AS
    v_revenue NUMBER := 0;
BEGIN
    SELECT NVL(SUM(total_amount), 0)
    INTO v_revenue
    FROM orders
    WHERE EXTRACT(YEAR FROM order_date) = p_year
    AND EXTRACT(MONTH FROM order_date) = p_month
    AND status = 'COMPLETED';
    
    RETURN v_revenue;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 0;
END calculate_monthly_revenue;

CREATE OR REPLACE FUNCTION calculate_customer_lifetime_value(
    p_customer_id IN NUMBER
) RETURN NUMBER AS
    v_total_value NUMBER := 0;
    v_order_count NUMBER := 0;
    v_avg_order_value NUMBER := 0;
BEGIN
    -- Get total value and order count
    SELECT NVL(SUM(total_amount), 0), COUNT(*)
    INTO v_total_value, v_order_count
    FROM orders
    WHERE customer_id = p_customer_id
    AND status = 'COMPLETED';
    
    -- Calculate average order value
    IF v_order_count > 0 THEN
        v_avg_order_value := v_total_value / v_order_count;
    END IF;
    
    RETURN v_total_value;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 0;
END calculate_customer_lifetime_value;

CREATE OR REPLACE PROCEDURE generate_sales_report(
    p_start_date IN DATE,
    p_end_date IN DATE,
    p_report_data OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_report_data FOR
        SELECT 
            c.customer_name,
            COUNT(o.order_id) as total_orders,
            SUM(o.total_amount) as total_revenue,
            AVG(o.total_amount) as avg_order_value,
            MAX(o.order_date) as last_order_date
        FROM customers c
        LEFT JOIN orders o ON c.customer_id = o.customer_id
        WHERE o.order_date BETWEEN p_start_date AND p_end_date
        OR o.order_date IS NULL
        GROUP BY c.customer_id, c.customer_name
        ORDER BY total_revenue DESC NULLS LAST;
        
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20019, 'Error generating sales report: ' || SQLERRM);
END generate_sales_report;

CREATE OR REPLACE FUNCTION get_top_selling_products(
    p_limit IN NUMBER DEFAULT 10
) RETURN SYS_REFCURSOR AS
    v_cursor SYS_REFCURSOR;
BEGIN
    OPEN v_cursor FOR
        SELECT 
            p.product_id,
            p.product_name,
            SUM(oi.quantity) as total_quantity_sold,
            SUM(oi.quantity * oi.unit_price) as total_revenue
        FROM products p
        JOIN order_items oi ON p.product_id = oi.product_id
        JOIN orders o ON oi.order_id = o.order_id
        WHERE o.status = 'COMPLETED'
        GROUP BY p.product_id, p.product_name
        ORDER BY total_quantity_sold DESC
        FETCH FIRST p_limit ROWS ONLY;
    
    RETURN v_cursor;
END get_top_selling_products;
