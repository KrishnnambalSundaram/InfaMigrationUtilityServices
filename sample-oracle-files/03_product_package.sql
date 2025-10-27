-- Product Management Package
-- Sample Oracle package with procedures and functions

CREATE OR REPLACE PACKAGE product_pkg AS
    -- Procedure declarations
    PROCEDURE add_product(
        p_name IN VARCHAR2,
        p_description IN VARCHAR2,
        p_price IN NUMBER,
        p_category_id IN NUMBER,
        p_product_id OUT NUMBER
    );
    
    PROCEDURE update_product_price(
        p_product_id IN NUMBER,
        p_new_price IN NUMBER
    );
    
    PROCEDURE get_product_details(
        p_product_id IN NUMBER,
        p_name OUT VARCHAR2,
        p_description OUT VARCHAR2,
        p_price OUT NUMBER,
        p_category OUT VARCHAR2
    );
    
    -- Function declarations
    FUNCTION get_product_count RETURN NUMBER;
    FUNCTION get_products_by_category(p_category_id IN NUMBER) RETURN SYS_REFCURSOR;
    FUNCTION calculate_discount(p_product_id IN NUMBER, p_quantity IN NUMBER) RETURN NUMBER;
    
END product_pkg;

CREATE OR REPLACE PACKAGE BODY product_pkg AS
    
    PROCEDURE add_product(
        p_name IN VARCHAR2,
        p_description IN VARCHAR2,
        p_price IN NUMBER,
        p_category_id IN NUMBER,
        p_product_id OUT NUMBER
    ) AS
    BEGIN
        -- Validate inputs
        IF p_name IS NULL OR p_price <= 0 THEN
            RAISE_APPLICATION_ERROR(-20008, 'Invalid product data');
        END IF;
        
        -- Get next product ID
        SELECT product_seq.NEXTVAL INTO p_product_id FROM DUAL;
        
        -- Insert product
        INSERT INTO products (product_id, product_name, description, price, category_id, created_date)
        VALUES (p_product_id, p_name, p_description, p_price, p_category_id, SYSDATE);
        
        COMMIT;
        
        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                RAISE_APPLICATION_ERROR(-20009, 'Error adding product: ' || SQLERRM);
    END add_product;
    
    PROCEDURE update_product_price(
        p_product_id IN NUMBER,
        p_new_price IN NUMBER
    ) AS
        v_count NUMBER;
    BEGIN
        -- Validate product exists
        SELECT COUNT(*) INTO v_count 
        FROM products 
        WHERE product_id = p_product_id;
        
        IF v_count = 0 THEN
            RAISE_APPLICATION_ERROR(-20010, 'Product not found');
        END IF;
        
        -- Update price
        UPDATE products 
        SET price = p_new_price, 
            last_updated = SYSDATE
        WHERE product_id = p_product_id;
        
        COMMIT;
        
        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                RAISE_APPLICATION_ERROR(-20011, 'Error updating product price: ' || SQLERRM);
    END update_product_price;
    
    PROCEDURE get_product_details(
        p_product_id IN NUMBER,
        p_name OUT VARCHAR2,
        p_description OUT VARCHAR2,
        p_price OUT NUMBER,
        p_category OUT VARCHAR2
    ) AS
    BEGIN
        SELECT p.product_name, p.description, p.price, c.category_name
        INTO p_name, p_description, p_price, p_category
        FROM products p
        JOIN categories c ON p.category_id = c.category_id
        WHERE p.product_id = p_product_id;
        
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20012, 'Product not found');
            WHEN OTHERS THEN
                RAISE_APPLICATION_ERROR(-20013, 'Error retrieving product details: ' || SQLERRM);
    END get_product_details;
    
    FUNCTION get_product_count RETURN NUMBER AS
        v_count NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_count FROM products;
        RETURN v_count;
    END get_product_count;
    
    FUNCTION get_products_by_category(p_category_id IN NUMBER) RETURN SYS_REFCURSOR AS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT product_id, product_name, price, description
            FROM products
            WHERE category_id = p_category_id
            ORDER BY product_name;
        
        RETURN v_cursor;
    END get_products_by_category;
    
    FUNCTION calculate_discount(p_product_id IN NUMBER, p_quantity IN NUMBER) RETURN NUMBER AS
        v_price NUMBER;
        v_discount_rate NUMBER := 0;
    BEGIN
        -- Get product price
        SELECT price INTO v_price FROM products WHERE product_id = p_product_id;
        
        -- Calculate discount based on quantity
        IF p_quantity >= 100 THEN
            v_discount_rate := 0.15; -- 15% discount
        ELSIF p_quantity >= 50 THEN
            v_discount_rate := 0.10; -- 10% discount
        ELSIF p_quantity >= 20 THEN
            v_discount_rate := 0.05; -- 5% discount
        END IF;
        
        RETURN v_price * p_quantity * v_discount_rate;
        
        EXCEPTION
            WHEN OTHERS THEN
                RETURN 0;
    END calculate_discount;
    
END product_pkg;
