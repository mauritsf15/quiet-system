using QuietSystem.Telemetry.Monitoring;

var checks = 0;
void Require(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    checks++;
    Console.WriteLine("PASS " + name);
}

var data = new Disk("data", ['D']);
var windows = new Disk("windows", [null, 'C']);
Disk? Select(Disk[] disks, string? root = @"C:\") => StorageSelection.SystemDrive(disks, root, disk => disk.Letters);
Require(Select([data, windows]) == windows, "System storage sensors come from the Windows disk even when another disk is enumerated first");
Require(Select([windows, data]) == windows, "Disk enumeration order does not change the selected storage");
Require(Select([new("other", ['D', 'E']), windows], @"c:\") == windows, "Partition matching ignores letter case and permits partitions without drive letters");
Require(Select([data]) is null, "Missing system-disk mapping does not substitute another disk's sensors");
Require(Select([windows, new("span", ['C'])]) is null, "A volume spanning several disks does not claim one physical disk's sensors");
Require(Select([windows], null) is null && Select([windows], "/") is null, "Missing or invalid Windows drive roots remain unavailable");
var broken = new Disk("removed", []);
Require(StorageSelection.SystemDrive([broken, data, windows], @"C:\", disk => disk == broken
    ? throw new IOException("Disk removed") : disk.Letters) == windows, "A removed disk does not hide the valid system disk");
Console.WriteLine($"{checks} storage selection checks passed.");

sealed record Disk(string Name, char?[] Letters);
