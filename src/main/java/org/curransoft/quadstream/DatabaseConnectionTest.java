package org.curransoft.quadstream;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

import javax.sql.DataSource;

import com.mchange.v2.c3p0.DataSources;

public class DatabaseConnectionTest {
	public static void main(String[] args) {
		String database = "us_shapes";
		String user = "ivpr";
		String pass = "ivpr";

		DataSource unpooled, pooled;
		try {
			unpooled = DataSources.unpooledDataSource("jdbc:mysql://129.63.16.126/"
					+ database, user, pass);
			pooled = DataSources.pooledDataSource(unpooled);
			Connection con = pooled.getConnection();
			Statement stmt = con.createStatement();
			ResultSet rs = stmt.executeQuery("show tables");
			while (rs.next())
				System.out.println(rs.getString(1));
		} catch (SQLException e) {
			e.printStackTrace();
		}

	}

}
