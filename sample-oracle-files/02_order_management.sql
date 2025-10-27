-- Order Management Functions and Procedures
-- Sample Oracle PL/SQL for order processing

CREATE OR REPLACE FUNCTION calculate_order_total(
    p_order_id IN NUMBER
) RETURN NUMBER AS
    v_total_amount NUMBER := 0;
    v_tax_rate NUMBER := 0.08;
    v_tax_amount NUMBER := 0;
BEGIN
    -- Calculate subtotal
    SELECT SUM(quantity * unit_price)
    INTO v_total_amount
    FROM order_items
    WHERE order_id = p_order_id;
    
    -- Calculate tax
    v_tax_amount := v_total_amount * v_tax_rate;
    
    -- Return total including tax
    RETURN NVL(v_total_amount, 0) + v_tax_amount;
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN 0;
END calculate_order_total;

CREATE OR REPLACE PROCEDURE process_order(
    p_customer_id IN NUMBER,
    p_order_items IN VARCHAR2, -- JSON-like string for simplicity
    p_order_id OUT NUMBER
) AS
    v_order_date DATE := SYSDATE;
    v_status VARCHAR2(20) := 'PENDING';
BEGIN
    -- Get next order ID
    SELECT order_seq.NEXTVAL INTO p_order_id FROM DUAL;
    
    -- Create order header
    INSERT INTO orders (order_id, customer_id, order_date, status, total_amount)
    VALUES (p_order_id, p_customer_id, v_order_date, v_status, 0);
    
    -- Calculate and update total
    UPDATE orders 
    SET total_amount = calculate_order_total(p_order_id)
    WHERE order_id = p_order_id;
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20005, 'Error processing order: ' || SQLERRM);
END process_order;

CREATE OR REPLACE PROCEDURE update_order_status(
    p_order_id IN NUMBER,
    p_new_status IN VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    -- Validate order exists
    SELECT COUNT(*) INTO v_count 
    FROM orders 
    WHERE order_id = p_order_id;
    
    IF v_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20006, 'Order not found');
    END IF;
    
    -- Update status
    UPDATE orders 
    SET status = p_new_status, 
        last_updated = SYSDATE
    WHERE order_id = p_order_id;
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20007, 'Error updating order status: ' || SQLERRM);
END update_order_status;
