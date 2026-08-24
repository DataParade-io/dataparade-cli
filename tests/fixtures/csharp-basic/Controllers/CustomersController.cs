using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Billing.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class CustomersController : ControllerBase
{
    private readonly HttpClient _client = new HttpClient();

    [HttpGet("{id}")]
    public IActionResult GetCustomer(int id) => Ok();

    [Authorize]
    [HttpPost]
    public async Task<IActionResult> ChargeCustomer()
    {
        await _client.PostAsync("https://api.stripe.com/v1/charges", null);
        return Ok();
    }
}
