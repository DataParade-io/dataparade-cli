package com.acme.billing.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;

public class DatabaseConfiguration {

    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://db.internal:5432/billing");
        config.setUsername(System.getenv("DB_USER"));
        return new HikariDataSource(config);
    }
}
