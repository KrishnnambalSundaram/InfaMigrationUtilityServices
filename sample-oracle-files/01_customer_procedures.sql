-- Customer Management Procedures
-- Sample Oracle PL/SQL procedures for customer operations

CREATE OR REPLACE PROCEDURE get_customer_info(
    p_customer_id IN NUMBER,
    p_customer_name OUT VARCHAR2,
    p_customer_email OUT VARCHAR2,
    p_customer_phone OUT VARCHAR2
) AS
BEGIN
    SELECT customer_name, email, phone_number
    INTO p_customer_name, p_customer_email, p_customer_phone
    FROM customers
    WHERE customer_id = p_customer_id;
    
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            p_customer_name := NULL;
            p_customer_email := NULL;
            p_customer_phone := NULL;
        WHEN OTHERS THEN
            RAISE_APPLICATION_ERROR(-20001, 'Error retrieving customer info: ' || SQLERRM);
END get_customer_info;

CREATE OR REPLACE PROCEDURE create_customer(
    p_name IN VARCHAR2,
    p_email IN VARCHAR2,
    p_phone IN VARCHAR2,
    p_address IN VARCHAR2,
    p_customer_id OUT NUMBER
) AS
BEGIN
    -- Get next sequence value
    SELECT customer_seq.NEXTVAL INTO p_customer_id FROM DUAL;
    
    -- Insert new customer
    INSERT INTO customers (customer_id, customer_name, email, phone_number, address, created_date)
    VALUES (p_customer_id, p_name, p_email, p_phone, p_address, SYSDATE);
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20002, 'Error creating customer: ' || SQLERRM);
END create_customer;

CREATE OR REPLACE PROCEDURE update_customer_address(
    p_customer_id IN NUMBER,
    p_new_address IN VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    -- Check if customer exists
    SELECT COUNT(*) INTO v_count 
    FROM customers 
    WHERE customer_id = p_customer_id;
    
    IF v_count = 0 THEN
        RAISE_APPLICATION_ERROR(-20003, 'Customer not found');
    END IF;
    
    -- Update address
    UPDATE customers 
    SET address = p_new_address, 
        last_updated = SYSDATE
    WHERE customer_id = p_customer_id;
    
    COMMIT;
    
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE_APPLICATION_ERROR(-20004, 'Error updating customer address: ' || SQLERRM);
END update_customer_address;
