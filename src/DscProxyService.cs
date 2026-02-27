// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Bicep.Extension.DSC;

using System.Diagnostics;
using System.IO.Pipes;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Bicep.Local.Rpc;
using Grpc.Core;
using Grpc.Net.Client;

/// <summary>
/// A gRPC proxy that forwards all Bicep extension RPCs to a child <c>dsc-bicep-ext</c> process.
/// Bicep starts this process, and this process starts <c>dsc-bicep-ext</c>, funneling requests between them.
/// </summary>
public class DscProxyService : BicepExtension.BicepExtensionBase, IHostedService, IAsyncDisposable
{
    private Process? process;
    private GrpcChannel? channel;
    private BicepExtension.BicepExtensionClient? client;
    private nint jobHandle;

    private BicepExtension.BicepExtensionClient Client
        => client ?? throw new RpcException(new Status(StatusCode.Unavailable, "dsc-bicep-ext is not ready"));

    private static void WriteTrace(Func<string> getMessage)
        => Trace.WriteLine($"[dsc-bicep-ext] {getMessage()}");

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        string processArgs;
        Func<GrpcChannel> channelBuilder;

        // While modern Windows technically supports UDS, many libraries (like Rust's Tokio) do not
        if (Socket.OSSupportsUnixDomainSockets && !OperatingSystem.IsWindows())
        {
            var socketName = $"{Guid.NewGuid()}.tmp";
            var socketPath = Path.Combine(Path.GetTempPath(), socketName);

            if (File.Exists(socketPath))
            {
                File.Delete(socketPath);
            }

            processArgs = $"--socket {socketPath}";
            channelBuilder = () => CreateDomainSocketChannel(socketPath);
        }
        else
        {
            var pipeName = $"{Guid.NewGuid()}.tmp";

            processArgs = $"--pipe {pipeName}";
            channelBuilder = () => CreateNamedPipeChannel(pipeName);
        }

        process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "dsc-bicep-ext",
                Arguments = processArgs,
                UseShellExecute = false,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            },
        };

        try
        {
            // 30s timeout for starting up the RPC connection
            var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

            process.EnableRaisingEvents = true;
            process.Exited += (sender, e) => cts.Cancel();
            process.OutputDataReceived += (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    WriteTrace(() => $"stdout: {e.Data}");
                }
            };
            process.ErrorDataReceived += (sender, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    WriteTrace(() => $"stderr: {e.Data}");
                }
            };

            process.Start();

            if (OperatingSystem.IsWindows())
            {
                AssignToJobObject(process);
            }

            process.BeginErrorReadLine();
            process.BeginOutputReadLine();

            channel = channelBuilder();
            client = new BicepExtension.BicepExtensionClient(channel);

            await WaitForConnectionAsync(client, cts.Token);
        }
        catch (Exception ex)
        {
            await TerminateProcess();
            throw new InvalidOperationException("Failed to connect to dsc-bicep-ext", ex);
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        await TerminateProcess();
    }

    public async ValueTask DisposeAsync()
    {
        await TerminateProcess();
        GC.SuppressFinalize(this);
    }

    private async Task TerminateProcess()
    {
        try
        {
            if (process is { HasExited: false })
            {
                process.Kill();

                // Wait for a maximum of 15s for shutdown to occur
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                await process.WaitForExitAsync(cts.Token);
            }
        }
        catch (Exception ex)
        {
            WriteTrace(() => $"Failed to terminate process: {ex}");
        }
        finally
        {
            channel?.Dispose();
            process?.Dispose();

            if (jobHandle != IntPtr.Zero)
            {
                CloseHandle(jobHandle);
                jobHandle = IntPtr.Zero;
            }
        }
    }

    public override async Task<LocalExtensibilityOperationResponse> CreateOrUpdate(
        ResourceSpecification request, ServerCallContext context)
        => await Client.CreateOrUpdateAsync(request, cancellationToken: context.CancellationToken);

    public override async Task<LocalExtensibilityOperationResponse> Preview(
        ResourceSpecification request, ServerCallContext context)
        => await Client.PreviewAsync(request, cancellationToken: context.CancellationToken);

    public override async Task<LocalExtensibilityOperationResponse> Get(
        ResourceReference request, ServerCallContext context)
        => await Client.GetAsync(request, cancellationToken: context.CancellationToken);

    public override async Task<LocalExtensibilityOperationResponse> Delete(
        ResourceReference request, ServerCallContext context)
        => await Client.DeleteAsync(request, cancellationToken: context.CancellationToken);

    public override async Task<TypeFilesResponse> GetTypeFiles(
        Empty request, ServerCallContext context)
        => await Client.GetTypeFilesAsync(request, cancellationToken: context.CancellationToken);

    public override Task<Empty> Ping(Empty request, ServerCallContext context)
        => Task.FromResult(new Empty());

    private static GrpcChannel CreateDomainSocketChannel(string socketPath)
    {
        var udsEndPoint = new UnixDomainSocketEndPoint(socketPath);

        async ValueTask<Stream> connectSocket(SocketsHttpConnectionContext _, CancellationToken cancellationToken)
        {
            var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);

            try
            {
                await socket.ConnectAsync(udsEndPoint, cancellationToken).ConfigureAwait(false);
                return new NetworkStream(socket, true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }

        var socketsHttpHandler = new SocketsHttpHandler
        {
            ConnectCallback = connectSocket,
        };

        // The URL is not used, but it must be a valid URI.
        return GrpcChannel.ForAddress("http://localhost", new GrpcChannelOptions
        {
            HttpHandler = socketsHttpHandler,
        });
    }

    private static GrpcChannel CreateNamedPipeChannel(string pipeName)
    {
        static async ValueTask<Stream> connectPipe(string pipeName, CancellationToken cancellationToken)
        {
            var clientStream = new NamedPipeClientStream(
                serverName: ".",
                pipeName: pipeName,
                direction: PipeDirection.InOut,
                options: PipeOptions.WriteThrough | PipeOptions.Asynchronous,
                impersonationLevel: TokenImpersonationLevel.Anonymous);

            try
            {
                await clientStream.ConnectAsync(cancellationToken).ConfigureAwait(false);
                return clientStream;
            }
            catch
            {
                await clientStream.DisposeAsync();
                throw;
            }
        }

        var socketsHttpHandler = new SocketsHttpHandler
        {
            ConnectCallback = (context, cancellationToken) => connectPipe(pipeName, cancellationToken),
        };

        return GrpcChannel.ForAddress("http://localhost", new GrpcChannelOptions
        {
            HttpHandler = socketsHttpHandler,
        });
    }

    private static async Task WaitForConnectionAsync(BicepExtension.BicepExtensionClient client, CancellationToken cancellationToken)
    {
        var connected = false;
        while (!connected)
        {
            try
            {
                await Task.Delay(50, cancellationToken);
                await client.PingAsync(new Empty(), cancellationToken: cancellationToken);
                connected = true;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable)
            {
                // ignore - server not yet ready
            }
        }
    }

    // Windows Job Object support: ensures child processes are killed when this process dies.
    // When our process is terminated (even via Kill/TerminateProcess), the OS closes the job
    // object handle, which automatically kills all processes assigned to the job.

    private void AssignToJobObject(Process childProcess)
    {
        jobHandle = CreateJobObject(IntPtr.Zero, null);
        if (jobHandle == IntPtr.Zero)
        {
            WriteTrace(() => $"Failed to create job object: {Marshal.GetLastPInvokeError()}");
            return;
        }

        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
            {
                LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
        };

        var length = Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        var infoPtr = Marshal.AllocHGlobal(length);
        try
        {
            Marshal.StructureToPtr(info, infoPtr, false);
            if (!SetInformationJobObject(jobHandle, JobObjectInfoClass.ExtendedLimitInformation, infoPtr, (uint)length))
            {
                WriteTrace(() => $"Failed to set job object info: {Marshal.GetLastPInvokeError()}");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(infoPtr);
        }

        if (!NativeAssignProcessToJobObject(jobHandle, childProcess.Handle))
        {
            WriteTrace(() => $"Failed to assign process to job object: {Marshal.GetLastPInvokeError()}");
        }
    }

    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    private enum JobObjectInfoClass
    {
        ExtendedLimitInformation = 9,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern nint CreateJobObject(nint securityAttributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(nint job, JobObjectInfoClass infoClass, nint info, uint length);

    [DllImport("kernel32.dll", EntryPoint = "AssignProcessToJobObject", SetLastError = true)]
    private static extern bool NativeAssignProcessToJobObject(nint job, nint process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint handle);
}
