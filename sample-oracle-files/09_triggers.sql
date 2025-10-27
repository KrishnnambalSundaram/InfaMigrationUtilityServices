-- Triggers for Data Integrity
-- Sample Oracle triggers for automated data management

CREATE OR REPLACE TRIGGER trg_customers_updated
    BEFORE UPDATE ON customers
    FOR EACH ROW
BEGIN
    :NEW.last_updated := SYSDATE;
END trg_customers_updated;

CREATE OR REPLACE TRIGGER trg_products_updated
    BEFORE UPDATE ON products
    FOR EACH ROW
BEGIN
    :NEW.last_updated := SYSDATE;
END trg_products_updated;

CREATE OR REPLACE TRIGGER trg_orders_updated
    BEFORE UPDATE ON orders
    FOR EACH ROW
BEGIN
    :NEW.last_updated := SYSDATE;
END trg_orders_updated;

CREATE OR REPLACE TRIGGER trg_inventory_updated
    BEFORE UPDATE ON inventory
    FOR EACH ROW
BEGIN
    :NEW.last_updated := SYSDATE;
END trg_inventory_updated;

CREATE OR REPLACE TRIGGER trg_order_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON order_items
    FOR EACH ROW
DECLARE
    v_action VARCHAR2(10);
BEGIN
    IF INSERTING THEN
        v_action := 'INSERT';
    ELSIF UPDATING THEN
        v_action := 'UPDATE';
    ELSIF DELETING THEN
        v_action := 'DELETE';
    END IF;
    
    INSERT INTO order_activity_log (
        log_id,
        order_id,
        activity_type,
        description,
        user_id,
        activity_date
    ) VALUES (
        activity_seq.NEXTVAL,
        COALESCE(:NEW.order_id, :OLD.order_id),
        'ORDER_ITEM_' || v_action,
        'Order item ' || v_action || ' - Product ID: ' || COALESCE(:NEW.product_id, :OLD.product_id),
        USER,
        SYSDATE
    );
END trg_order_items_audit;

CREATE OR REPLACE TRIGGER trg_customer_email_validation
    BEFORE INSERT OR UPDATE ON customers
    FOR EACH ROW
BEGIN
    -- Validate email format if provided
    IF :NEW.email IS NOT NULL THEN
        IF NOT REGEXP_LIKE(:NEW.email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
            RAISE_APPLICATION_ERROR(-20025, 'Invalid email format');
        END IF;
        
        -- Convert email to lowercase
        :NEW.email := LOWER(:NEW.email);
    END IF;
    
    -- Clean up customer name
    IF :NEW.customer_name IS NOT NULL THEN
        :NEW.customer_name := INITCAP(TRIM(:NEW.customer_name));
    END IF;
END trg_customer_email_validation;

CREATE OR REPLACE TRIGGER trg_product_price_validation
    BEFORE INSERT OR UPDATE ON products
    FOR EACH ROW
BEGIN
    -- Validate price is positive
    IF :NEW.price <= 0 THEN
        RAISE_APPLICATION_ERROR(-20026, 'Product price must be greater than 0');
    END IF;
    
    -- Log price changes
    IF UPDATING AND :OLD.price != :NEW.price THEN
        INSERT INTO customer_audit_log (
            audit_id,
            customer_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            change_date
        ) VALUES (
            audit_seq.NEXTVAL,
            :NEW.product_id, -- Using product_id as customer_id for this audit
            'PRICE',
            TO_CHAR(:OLD.price),
            TO_CHAR(:NEW.price),
            USER,
            SYSDATE
        );
    END IF;
END trg_product_price_validation;

CREATE OR REPLACE TRIGGER trg_order_status_change
    AFTER UPDATE OF status ON orders
    FOR EACH ROW
BEGIN
    -- Log status changes
    IF :OLD.status != :NEW.status THEN
        INSERT INTO order_activity_log (
            log_id,
            order_id,
            activity_type,
            description,
            user_id,
            activity_date
        ) VALUES (
            activity_seq.NEXTVAL,
            :NEW.order_id,
            'STATUS_CHANGE',
            'Order status changed from ' || :OLD.status || ' to ' || :NEW.status,
            USER,
            SYSDATE
        );
    END IF;
END trg_order_status_change;
