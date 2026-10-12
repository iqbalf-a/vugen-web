/* Statement yang belum didukung -> node Unsupported, tidak crash. */
Action()
{
    int i = 0;
    char *msg = "halo";
    struct Point { int x; int y; };
    goto selesai;
selesai:
    return 0;
}
