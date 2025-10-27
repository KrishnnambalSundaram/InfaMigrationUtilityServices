-- Inventory Management Procedures
-- Sample Oracle PL/SQL for inventory tracking

CREATE OR REPLACE PROCEDURE update_inventory(
    p_product_id IN NUMBER,
    p_quantity_change IN NUMBER,
    p_transaction_type IN VARCHAR2 -- 'IN' for stock in, 'OUT' for stock out
) AS
    v_current_stock NUMBER;
    v_new_stock NUMBER;
    v_count NUMBER;
BEGIN
    -- Validate product exists
    SELECT COUNT(*) INTO v_count 
    FROM products 
    WHERE product_id = p_product_id;
    
    IF v_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20014, 'Product not found');
    END IF;
    
    -- Get current stock
    SELECT NVL(stock_quantity, 0) INTO v_current_stock
    FROM inventory
    WHERE product_id = p_product_id;
    
    -- Calculate new stock
    IF p_transaction_type = 'IN' THEN
        v_new_stock := v_current_stock + p_quantity_change;
    ELSIF p_transaction_type = 'OUT' THEN
        v_new_stock := v_current_stock - p_quantity_change;
        
        -- Check for negative stock
        IF v_new_stock < 0 THEN
            RAISE_APPLICATION_ERROR(-20015, 'Insufficient stock');
        END IF;
    ELSE
        RAISE_APPLICATION_ERROR(-20016, 'Invalid transaction type');
    END IF;
    
    -- Update inventory
    MERGE INTO inventory i
    USING (SELECT p_product_id as product_id FROM DUAL) s
    ON (i.product_id = s.product_id)
    WHEN MATCHED THEN
        UPDATE SET stock_quantity = v_new_stock, last_updated = SYSDATE
    WHEN NOT MATCHED THEN
        INSERT (product_id, stock_quantity, last_updated)
        VALUES (p_product_id, v_new_stock, SYSDATE);
    
    -- Log transaction
    INSERT INTO inventory_transactions (product_id, transaction_type, quantity_change, new_stock, transaction_date)
    VALUES (p_product_id, p_transaction_type, p_quantity_change, v_new_stock, SYSDATE);
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20017, 'Error updating inventory: ' || SQLERRM);
END update_inventory;

CREATE OR REPLACE FUNCTION check_low_stock(p_threshold IN NUMBER DEFAULT 10) RETURN SYS_REFCURSOR AS
    v_cursor SYS_REFCURSOR;
BEGIN
    OPEN v_cursor FOR
        SELECT p.product_id, p.product_name, i.stock_quantity
        FROM products p
        JOIN inventory i ON p.product_id = i.product_id
        WHERE i.stock_quantity <= p_threshold
        ORDER BY i.stock_quantity ASC;
    
    RETURN v_cursor;
END check_low_stock;

CREATE OR REPLACE PROCEDURE reorder_products(
    p_threshold IN NUMBER DEFAULT 10,
    p_reorder_quantity IN NUMBER DEFAULT 100
) AS
    v_product_id NUMBER;
    v_product_name VARCHAR2(100);
    v_current_stock NUMBER;
    v_reorder_count NUMBER := 0;
    
    CURSOR low_stock_cursor IS
        SELECT p.product_id, p.product_name, i.stock_quantity
        FROM products p
        JOIN inventory i ON p.product_id = i.product_id
        WHERE i.stock_quantity <= p_threshold;
        
BEGIN
    FOR rec IN low_stock_cursor LOOP
        -- Update inventory with reorder quantity
        update_inventory(rec.product_id, p_reorder_quantity, 'IN');
        
        v_reorder_count := v_reorder_count + 1;
        
        DBMS_OUTPUT.PUT_LINE('Reordered ' || p_reorder_quantity || ' units of ' || rec.product_name);
    END LOOP;
    
    DBMS_OUTPUT.PUT_LINE('Total products reordered: ' || v_reorder_count);
    
    EXCEPTION
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20018, 'Error in reorder process: ' || SQLERRM);
END reorder_products;
