#include <crt_externs.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

typedef int (*SetDisclaim)(posix_spawnattr_t *, bool);

static int fail(const char *operation, int error) {
    fprintf(stderr, "Codex Theme app launch failed: %s: %s\n", operation, strerror(error));
    return 126;
}

static int replace_app(char *argv[], int input, int output) {
    // Keep the official app responsible for its privacy requests after exec.
    SetDisclaim set_disclaim = (SetDisclaim)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    if (set_disclaim == NULL) return fail("macOS responsibility API unavailable", ENOSYS);
    posix_spawnattr_t attributes;
    int error = posix_spawnattr_init(&attributes);
    if (error != 0) return fail("posix_spawnattr_init", error);
    error = set_disclaim(&attributes, true);
    if (error != 0) return fail("set launch responsibility", error);
    error = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETEXEC | POSIX_SPAWN_CLOEXEC_DEFAULT);
    if (error != 0) return fail("posix_spawnattr_setflags", error);
    posix_spawn_file_actions_t actions;
    error = posix_spawn_file_actions_init(&actions);
    if (error != 0) return fail("posix_spawn_file_actions_init", error);
    for (int fd = 0; fd <= 4; ++fd) {
        int source = fd == 3 ? input : fd == 4 ? output : fd;
        if (fcntl(source, F_GETFD) == -1) {
            if (errno == EBADF && source == fd) continue;
            return fail("inspect inherited descriptor", errno);
        }
        error = source == fd ? posix_spawn_file_actions_addinherit_np(&actions, fd)
                             : posix_spawn_file_actions_adddup2(&actions, source, fd);
        if (error != 0) return fail("inherit descriptor", error);
    }
    error = posix_spawn(NULL, argv[0], &actions, &attributes, argv, *_NSGetEnviron());
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    return fail("posix_spawn", error); // Successful SETEXEC never returns.
}

static int high_pipe(int descriptors[2]) {
    int pair[2];
    if (pipe(pair) != 0) return errno;
    // Keep mapping sources away from stdio/CDP destinations during spawn.
    descriptors[0] = fcntl(pair[0], F_DUPFD, 10);
    descriptors[1] = fcntl(pair[1], F_DUPFD, 10);
    int error = errno;
    close(pair[0]);
    close(pair[1]);
    if (descriptors[0] < 0 || descriptors[1] < 0) return error;
    return 0;
}

static int launch_gui(int argc, char *argv[]) {
    if (argc < 5 || argv[2][0] != '/' || argv[3][0] != '/' || argv[4][0] != '/')
        return fail("expected absolute worker, script, and app paths", EINVAL);
    int to_app[2], from_app[2];
    int error = high_pipe(to_app);
    if (error == 0) error = high_pipe(from_app);
    if (error != 0) return fail("create CDP pipes", error);
    posix_spawnattr_t attributes;
    posix_spawn_file_actions_t actions;
    posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT);
    posix_spawn_file_actions_init(&actions);
    for (int fd = 0; fd <= 2; ++fd) {
        if (fcntl(fd, F_GETFD) != -1) posix_spawn_file_actions_addinherit_np(&actions, fd);
    }
    posix_spawn_file_actions_adddup2(&actions, to_app[1], 3);
    posix_spawn_file_actions_adddup2(&actions, from_app[0], 4);
    char parent_pid[32];
    snprintf(parent_pid, sizeof(parent_pid), "%d", getpid());
    char *worker_argv[] = { argv[2], argv[3], "--attach-app", parent_pid, NULL };
    pid_t worker;
    error = posix_spawn(&worker, argv[2], &actions, &attributes, worker_argv, *_NSGetEnviron());
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    if (error != 0) return fail("start theme worker", error);
    // The Dock launch PID becomes the official app; only the invisible worker
    // gets a new PID. Launch Services can finish the original launch directly.
    int status = replace_app(&argv[4], to_app[0], from_app[1]);
    kill(worker, SIGTERM);
    waitpid(worker, NULL, 0);
    return status;
}

int main(int argc, char *argv[]) {
    if (argc == 2 && strcmp(argv[1], "--check") == 0) {
        if (dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim") == NULL)
            return fail("macOS responsibility API unavailable", ENOSYS);
        puts("codex-theme-app-launcher 2");
        return 0;
    }
    if (argc > 1 && strcmp(argv[1], "--gui") == 0) return launch_gui(argc, argv);
    if (argc < 2 || argv[1][0] != '/') return fail("expected an absolute executable path", EINVAL);
    return replace_app(&argv[1], 3, 4);
}
