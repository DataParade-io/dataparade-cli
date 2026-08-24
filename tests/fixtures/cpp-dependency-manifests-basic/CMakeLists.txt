cmake_minimum_required(VERSION 3.20)
project(billing_service CXX)

find_package(SQLite3 REQUIRED)
find_package(fmt CONFIG REQUIRED)

add_executable(billing_service main.cpp)
