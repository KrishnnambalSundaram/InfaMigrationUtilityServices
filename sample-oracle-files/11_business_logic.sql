-- Complex Business Logic Procedures
-- Sample Oracle PL/SQL with advanced business rules

CREATE OR REPLACE PROCEDURE process_monthly_billing(
    p_year IN NUMBER,
    p_month IN NUMBER
) AS
    v_customer_id NUMBER;
    v_customer_name VARCHAR2(100);
    v_total_amount NUMBER;
    v_billing_date DATE := LAST_DAY(TO_DATE(p_year || '-' || LPAD(p_month, 2, '0') || '-01'));
    v_processed_count NUMBER := 0;
    
    CURSOR customer_cursor IS
        SELECT DISTINCT c.customer_id, c.customer_name
        FROM customers c
        JOIN orders o ON c.customer_id = o.customer_id
        WHERE EXTRACT(YEAR FROM o.order_date) = p_year
        AND EXTRACT(MONTH FROM o.order_date) = p_month
        AND o.status = 'COMPLETED';
        
BEGIN
    DBMS_OUTPUT.PUT_LINE('Starting monthly billing process for ' || p_year || '-' || LPAD(p_month, 2, '0'));
    
    FOR rec IN customer_cursor LOOP
        -- Calculate total amount for the month
        SELECT SUM(total_amount)
        INTO v_total_amount
        FROM orders
        WHERE customer_id = rec.customer_id
        AND EXTRACT(YEAR FROM order_date) = p_year
        AND EXTRACT(MONTH FROM order_date) = p_month
        AND status = 'COMPLETED';
        
        -- Create billing record (assuming billing table exists)
        INSERT INTO monthly_billing (
            billing_id,
            customer_id,
            billing_year,
            billing_month,
            total_amount,
            billing_date,
            status
        ) VALUES (
            billing_seq.NEXTVAL,
            rec.customer_id,
            p_year,
            p_month,
            v_total_amount,
            v_billing_date,
            'PENDING'
        );
        
        v_processed_count := v_processed_count + 1;
        
        DBMS_OUTPUT.PUT_LINE('Processed billing for customer ' || rec.customer_name || ': $' || v_total_amount);
    END LOOP;
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Monthly billing process completed. Processed ' || v_processed_count || ' customers.');
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20027, 'Error in monthly billing process: ' || SQLERRM);
END process_monthly_billing;

CREATE OR REPLACE FUNCTION calculate_dynamic_pricing(
    p_product_id IN NUMBER,
    p_quantity IN NUMBER,
    p_customer_tier IN VARCHAR2 DEFAULT 'STANDARD'
) RETURN NUMBER AS
    v_base_price NUMBER;
    v_discount_rate NUMBER := 0;
    v_volume_discount NUMBER := 0;
    v_tier_discount NUMBER := 0;
    v_final_price NUMBER;
BEGIN
    -- Get base price
    SELECT price INTO v_base_price FROM products WHERE product_id = p_product_id;
    
    -- Calculate volume discount
    IF p_quantity >= 1000 THEN
        v_volume_discount := 0.20; -- 20% discount
    ELSIF p_quantity >= 500 THEN
        v_volume_discount := 0.15; -- 15% discount
    ELSIF p_quantity >= 100 THEN
        v_volume_discount := 0.10; -- 10% discount
    ELSIF p_quantity >= 50 THEN
        v_volume_discount := 0.05; -- 5% discount
    END IF;
    
    -- Calculate tier discount
    CASE p_customer_tier
        WHEN 'PREMIUM' THEN v_tier_discount := 0.10; -- 10% discount
        WHEN 'GOLD' THEN v_tier_discount := 0.15; -- 15% discount
        WHEN 'PLATINUM' THEN v_tier_discount := 0.20; -- 20% discount
        ELSE v_tier_discount := 0;
    END CASE;
    
    -- Calculate final discount (maximum of volume and tier)
    v_discount_rate := GREATEST(v_volume_discount, v_tier_discount);
    
    -- Calculate final price
    v_final_price := v_base_price * (1 - v_discount_rate);
    
    RETURN ROUND(v_final_price, 2);
    
    EXCEPTION
        WHEN OTHERS THEN
            RETURN v_base_price;
END calculate_dynamic_pricing;

CREATE OR REPLACE PROCEDURE analyze_customer_behavior(
    p_customer_id IN NUMBER
) AS
    v_order_count NUMBER;
    v_avg_order_value NUMBER;
    v_last_order_date DATE;
    v_days_since_last_order NUMBER;
    v_customer_tier VARCHAR2(20);
    v_recommendations VARCHAR2(500);
    
BEGIN
    -- Get customer statistics
    SELECT 
        COUNT(*),
        AVG(total_amount),
        MAX(order_date)
    INTO v_order_count, v_avg_order_value, v_last_order_date
    FROM orders
    WHERE customer_id = p_customer_id
    AND status = 'COMPLETED';
    
    -- Calculate days since last order
    v_days_since_last_order := SYSDATE - NVL(v_last_order_date, SYSDATE);
    
    -- Determine customer tier
    IF v_order_count >= 50 AND v_avg_order_value >= 500 THEN
        v_customer_tier := 'PLATINUM';
    ELSIF v_order_count >= 20 AND v_avg_order_value >= 200 THEN
        v_customer_tier := 'GOLD';
    ELSIF v_order_count >= 10 AND v_avg_order_value >= 100 THEN
        v_customer_tier := 'PREMIUM';
    ELSE
        v_customer_tier := 'STANDARD';
    END IF;
    
    -- Generate recommendations
    v_recommendations := '';
    
    IF v_days_since_last_order > 90 THEN
        v_recommendations := v_recommendations || 'Send re-engagement campaign; ';
    END IF;
    
    IF v_customer_tier = 'PLATINUM' THEN
        v_recommendations := v_recommendations || 'Offer exclusive products; ';
    END IF;
    
    IF v_avg_order_value < 50 THEN
        v_recommendations := v_recommendations || 'Suggest product bundles; ';
    END IF;
    
    -- Update customer tier (assuming customer table has tier column)
    UPDATE customers 
    SET customer_tier = v_customer_tier,
        last_analysis_date = SYSDATE
    WHERE customer_id = p_customer_id;
    
    -- Log analysis results
    INSERT INTO customer_analysis_log (
        analysis_id,
        customer_id,
        order_count,
        avg_order_value,
        days_since_last_order,
        customer_tier,
        recommendations,
        analysis_date
    ) VALUES (
        analysis_seq.NEXTVAL,
        p_customer_id,
        v_order_count,
        v_avg_order_value,
        v_days_since_last_order,
        v_customer_tier,
        v_recommendations,
        SYSDATE
    );
    
    COMMIT;
    
    DBMS_OUTPUT.PUT_LINE('Customer ' || p_customer_id || ' analyzed. Tier: ' || v_customer_tier);
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20028, 'Error analyzing customer behavior: ' || SQLERRM);
END analyze_customer_behavior;
