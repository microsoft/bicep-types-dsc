// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Bicep.Extension.DSC;
using Bicep.Local.Extension.Host.Extensions;

var builder = WebApplication.CreateBuilder();

builder.AddBicepExtensionHost(args);
builder.Services.AddGrpc();
builder.Services.AddSingleton<DscProxyService>();
builder.Services.AddSingleton<IHostedService>(sp => sp.GetRequiredService<DscProxyService>());

var app = builder.Build();

app.MapGrpcService<DscProxyService>();

await app.RunAsync();
