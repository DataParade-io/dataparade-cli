package com.acme.ledger

import io.ktor.client.HttpClient
import io.ktor.server.application.Application
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import org.jetbrains.exposed.sql.Database

fun Application.ledgerRoutes() {
    Database.connect(
        url = "jdbc:postgresql://db.internal:5432/ledger",
        driver = "org.postgresql.Driver",
    )

    routing {
        get("/health") {
            call.respondText("ok")
        }
        post("/api/invoices") {
            call.respondText("created")
        }
    }
}

suspend fun fetchRates(client: HttpClient): String {
    val token = System.getenv("RATES_TOKEN")
    return client.get("https://api.exchangerate.host/latest").bodyAsText()
}
