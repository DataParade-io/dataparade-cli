package com.acme.billing.web;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/api/customers")
public class CustomersController {

    @Value("${billing.rates.url}")
    private String ratesUrl;

    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping("/{id}")
    public Customer byId(@PathVariable Long id) {
        return repository.findById(id);
    }

    @PostMapping
    public Customer create(@RequestBody Customer customer) {
        String apiKey = System.getenv("BILLING_API_KEY");
        return restTemplate.postForObject("https://api.stripe.com/v1/customers", customer, Customer.class);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @RequestMapping(
        value = "/{id}",
        method = RequestMethod.DELETE)
    public void remove(@PathVariable Long id) {
        repository.delete(id);
    }
}
