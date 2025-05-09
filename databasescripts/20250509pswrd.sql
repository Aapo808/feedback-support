alter table users
add password varchar(255);

update system_users
set password= "$2b$10$YFgdsCJC0d8y1kPIX.bOEOBicbxO/GTJx.P3hlAeq6m"
where id in (14,15,16);