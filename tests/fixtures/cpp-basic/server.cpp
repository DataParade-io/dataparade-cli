#include <crow.h>
#include <curl/curl.h>
#include <pqxx/pqxx>
#include <cstdlib>

#include <string>

std::string FetchCustomer(const std::string& id) {
  CURL* curl = curl_easy_init();
  curl_easy_setopt(curl, CURLOPT_URL, "https://api.stripe.com/v1/customers");
  return id;
}

int main() {
  crow::SimpleApp app;

  const char* database_url = std::getenv("DATABASE_URL");
  pqxx::connection connection(database_url);

  CROW_ROUTE(app, "/customers")([]() {
    return crow::response(200);
  });

  CROW_ROUTE(app, "/health")([]() {
    return crow::response(200);
  });

  app.port(8080).run();
  return 0;
}
