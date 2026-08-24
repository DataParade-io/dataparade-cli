using System;
using Microsoft.EntityFrameworkCore;

namespace Billing.Api.Data;

public class AppDbContext : DbContext
{
    protected override void OnConfiguring(DbContextOptionsBuilder options)
    {
        options.UseNpgsql(Environment.GetEnvironmentVariable("DATABASE_URL"));
    }
}
