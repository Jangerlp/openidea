use crate::{encoding, mtime_ms, ops};
use ide_core::IdeResult;
use std::fs;
use std::path::{Path, PathBuf};

/// Capabilities whose behavior cannot be assumed across filesystem adapters.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FileSystemCapabilities {
    /// Symlinks can be identified and preserved by supported operations.
    pub symlinks: bool,
    /// Read/write permissions can be queried or changed.
    pub permissions: bool,
    /// Recoverable deletion is available.
    pub trash: bool,
    /// Filesystem change notifications are available.
    pub watching: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileSystemEntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

/// Filesystem metadata independent of `std::fs::Metadata`.
#[derive(Clone, Debug, PartialEq)]
pub struct FileSystemMetadata {
    pub kind: FileSystemEntryKind,
    pub size: u64,
    pub mtime_ms: f64,
    pub read_only: bool,
}

/// One child returned from a single-level directory listing.
#[derive(Clone, Debug, PartialEq)]
pub struct FileSystemEntry {
    pub name: String,
    pub path: PathBuf,
    /// Metadata for a symlink itself, not the object it points to.
    pub metadata: FileSystemMetadata,
    /// Metadata for a symlink target, or `None` for other entries or dangling links.
    pub target: Option<FileSystemMetadata>,
}

/// Synchronous filesystem contract for operations that can be backed by either
/// native storage or an explicitly granted browser filesystem.
///
/// Paths are adapter-relative paths. Implementations must not assume that a
/// path is available on the host OS. Unsupported capabilities return
/// [`ide_core::IdeError::unavailable`] instead of approximating native behavior.
pub trait FileSystem {
    fn capabilities(&self) -> FileSystemCapabilities;
    fn read_bytes(&self, path: &Path) -> IdeResult<Vec<u8>>;
    /// Atomically replaces an existing file; the parent directory must exist.
    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> IdeResult<f64>;
    /// Lists direct children. Ordering is adapter-defined.
    fn list_dir(&self, path: &Path) -> IdeResult<Vec<FileSystemEntry>>;
    /// Follows symlinks; listing metadata preserves symlink identity.
    fn metadata(&self, path: &Path) -> IdeResult<FileSystemMetadata>;
    fn create_file(&self, path: &Path) -> IdeResult<()>;
    fn create_dir(&self, path: &Path) -> IdeResult<()>;
    fn rename(&self, from: &Path, to: &Path) -> IdeResult<()>;
    /// Deletes using the adapter's recoverable-delete behavior.
    fn delete(&self, path: &Path) -> IdeResult<()>;
    fn delete_permanently(&self, path: &Path) -> IdeResult<()>;
    fn copy(&self, from: &Path, to: &Path) -> IdeResult<()>;
    fn set_writable(&self, path: &Path, writable: bool) -> IdeResult<()>;
}

/// Adapter preserving the existing native filesystem implementation.
#[derive(Clone, Copy, Debug, Default)]
pub struct NativeFileSystem;

impl FileSystem for NativeFileSystem {
    fn capabilities(&self) -> FileSystemCapabilities {
        FileSystemCapabilities { symlinks: cfg!(unix), permissions: true, trash: true, watching: true }
    }

    fn read_bytes(&self, path: &Path) -> IdeResult<Vec<u8>> {
        Ok(fs::read(path)?)
    }

    fn write_atomic(&self, path: &Path, bytes: &[u8]) -> IdeResult<f64> {
        encoding::write_atomic(path, bytes)
    }

    fn list_dir(&self, path: &Path) -> IdeResult<Vec<FileSystemEntry>> {
        let mut entries = Vec::new();
        for item in fs::read_dir(path)? {
            let item = item?;
            let child_path = item.path();
            let metadata = fs::symlink_metadata(&child_path)?;
            let is_symlink = metadata.file_type().is_symlink();
            let target =
                if is_symlink { fs::metadata(&child_path).ok().map(|meta| native_metadata(&meta)) } else { None };
            entries.push(FileSystemEntry {
                name: item.file_name().to_string_lossy().into_owned(),
                path: child_path,
                metadata: native_metadata(&metadata),
                target,
            });
        }
        Ok(entries)
    }

    fn metadata(&self, path: &Path) -> IdeResult<FileSystemMetadata> {
        Ok(native_metadata(&fs::metadata(path)?))
    }

    fn create_file(&self, path: &Path) -> IdeResult<()> {
        ops::create_file(path)
    }

    fn create_dir(&self, path: &Path) -> IdeResult<()> {
        ops::create_dir(path)
    }

    fn rename(&self, from: &Path, to: &Path) -> IdeResult<()> {
        ops::rename(from, to)
    }

    fn delete(&self, path: &Path) -> IdeResult<()> {
        ops::delete(path, !cfg!(test))
    }

    fn delete_permanently(&self, path: &Path) -> IdeResult<()> {
        ops::delete(path, false)
    }

    fn copy(&self, from: &Path, to: &Path) -> IdeResult<()> {
        ops::copy(from, to)
    }

    fn set_writable(&self, path: &Path, writable: bool) -> IdeResult<()> {
        ops::set_writable(path, writable)
    }
}

fn native_metadata(metadata: &fs::Metadata) -> FileSystemMetadata {
    let file_type = metadata.file_type();
    let kind = if file_type.is_symlink() {
        FileSystemEntryKind::Symlink
    } else if metadata.is_dir() {
        FileSystemEntryKind::Directory
    } else if metadata.is_file() {
        FileSystemEntryKind::File
    } else {
        FileSystemEntryKind::Other
    };
    FileSystemMetadata {
        kind,
        size: metadata.len(),
        mtime_ms: mtime_ms(metadata),
        read_only: metadata.permissions().readonly(),
    }
}

#[cfg(test)]
pub(crate) mod memory {
    use super::*;
    use ide_core::IdeError;
    use std::collections::BTreeMap;
    #[derive(Clone, Debug)]
    enum Node {
        Directory,
        File(Vec<u8>),
    }

    /// Deterministic in-memory adapter for contract-level tests.
    #[derive(Debug)]
    pub(crate) struct MemoryFileSystem {
        nodes: std::sync::RwLock<BTreeMap<PathBuf, Node>>,
    }

    impl Default for MemoryFileSystem {
        fn default() -> Self {
            Self { nodes: std::sync::RwLock::new(BTreeMap::from([(PathBuf::from("/"), Node::Directory)])) }
        }
    }

    impl MemoryFileSystem {
        fn require_parent(nodes: &BTreeMap<PathBuf, Node>, path: &Path) -> IdeResult<()> {
            let Some(parent) = path.parent() else { return Ok(()) };
            if parent.as_os_str().is_empty() {
                return Ok(());
            }
            match nodes.get(parent) {
                Some(Node::Directory) => Ok(()),
                Some(Node::File(_)) => Err(IdeError::invalid(format!("{} is not a directory", parent.display()))),
                None => Err(IdeError::not_found(format!("{} does not exist", parent.display()))),
            }
        }

        fn ensure_parent(nodes: &mut BTreeMap<PathBuf, Node>, path: &Path) -> IdeResult<()> {
            let Some(parent) = path.parent() else { return Ok(()) };
            if parent.as_os_str().is_empty() {
                return Ok(());
            }
            if nodes.get(parent).is_some_and(|node| !matches!(node, Node::Directory)) {
                return Err(IdeError::invalid(format!("{} is not a directory", parent.display())));
            }
            nodes.entry(parent.to_path_buf()).or_insert(Node::Directory);
            Self::ensure_parent(nodes, parent)
        }

        fn required_node<'a>(nodes: &'a BTreeMap<PathBuf, Node>, path: &Path) -> IdeResult<&'a Node> {
            nodes.get(path).ok_or_else(|| IdeError::not_found(format!("{} does not exist", path.display())))
        }

        fn metadata_for(node: &Node) -> FileSystemMetadata {
            FileSystemMetadata {
                kind: match node {
                    Node::Directory => FileSystemEntryKind::Directory,
                    Node::File(_) => FileSystemEntryKind::File,
                },
                size: match node {
                    Node::Directory => 0,
                    Node::File(bytes) => bytes.len() as u64,
                },
                mtime_ms: 0.0,
                read_only: false,
            }
        }
    }

    impl FileSystem for MemoryFileSystem {
        fn capabilities(&self) -> FileSystemCapabilities {
            FileSystemCapabilities::default()
        }

        fn read_bytes(&self, path: &Path) -> IdeResult<Vec<u8>> {
            match Self::required_node(&self.nodes.read().unwrap(), path)? {
                Node::File(bytes) => Ok(bytes.clone()),
                Node::Directory => Err(IdeError::invalid(format!("{} is a directory", path.display()))),
            }
        }

        fn write_atomic(&self, path: &Path, bytes: &[u8]) -> IdeResult<f64> {
            let mut nodes = self.nodes.write().unwrap();
            Self::require_parent(&nodes, path)?;
            if nodes.get(path).is_some_and(|node| matches!(node, Node::Directory)) {
                return Err(IdeError::invalid(format!("{} is a directory", path.display())));
            }
            nodes.insert(path.to_path_buf(), Node::File(bytes.to_vec()));
            Ok(Self::metadata_for(nodes.get(path).unwrap()).mtime_ms)
        }

        fn list_dir(&self, path: &Path) -> IdeResult<Vec<FileSystemEntry>> {
            let nodes = self.nodes.read().unwrap();
            if !matches!(Self::required_node(&nodes, path)?, Node::Directory) {
                return Err(IdeError::invalid(format!("{} is not a directory", path.display())));
            }
            let mut entries = Vec::new();
            for (child, node) in nodes.iter().filter(|(child, _)| child.parent() == Some(path)) {
                entries.push(FileSystemEntry {
                    name: child.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    path: child.clone(),
                    metadata: Self::metadata_for(node),
                    target: None,
                });
            }
            Ok(entries)
        }

        fn metadata(&self, path: &Path) -> IdeResult<FileSystemMetadata> {
            let nodes = self.nodes.read().unwrap();
            let node = Self::required_node(&nodes, path)?;
            Ok(Self::metadata_for(node))
        }

        fn create_file(&self, path: &Path) -> IdeResult<()> {
            let mut nodes = self.nodes.write().unwrap();
            if nodes.contains_key(path) {
                return Err(IdeError::new(
                    ide_core::error::ErrorKind::AlreadyExists,
                    format!("{} already exists", path.display()),
                ));
            }
            Self::ensure_parent(&mut nodes, path)?;
            nodes.insert(path.to_path_buf(), Node::File(Vec::new()));
            Ok(())
        }

        fn delete(&self, _path: &Path) -> IdeResult<()> {
            Err(IdeError::unavailable("trash is not supported by this filesystem"))
        }

        fn create_dir(&self, path: &Path) -> IdeResult<()> {
            let mut nodes = self.nodes.write().unwrap();
            if nodes.contains_key(path) {
                return Err(IdeError::new(
                    ide_core::error::ErrorKind::AlreadyExists,
                    format!("{} already exists", path.display()),
                ));
            }
            Self::ensure_parent(&mut nodes, path)?;
            nodes.insert(path.to_path_buf(), Node::Directory);
            Ok(())
        }

        fn rename(&self, from: &Path, to: &Path) -> IdeResult<()> {
            let mut nodes = self.nodes.write().unwrap();
            Self::required_node(&nodes, from)?;
            if from == to {
                return Ok(());
            }
            if nodes.contains_key(to) {
                return Err(IdeError::new(
                    ide_core::error::ErrorKind::AlreadyExists,
                    format!("{} already exists", to.display()),
                ));
            }
            if to.starts_with(from) {
                return Err(IdeError::invalid(format!("cannot move {} into itself", from.display())));
            }
            Self::ensure_parent(&mut nodes, to)?;
            let moving: Vec<_> = nodes
                .iter()
                .filter(|(path, _)| *path == from || path.starts_with(from))
                .map(|(path, node)| (path.clone(), node.clone()))
                .collect();
            for (path, _) in &moving {
                nodes.remove(path);
            }
            for (path, node) in moving {
                let suffix = path.strip_prefix(from).expect("selected descendant");
                nodes.insert(to.join(suffix), node);
            }
            Ok(())
        }

        fn delete_permanently(&self, path: &Path) -> IdeResult<()> {
            let mut nodes = self.nodes.write().unwrap();
            Self::required_node(&nodes, path)?;
            nodes.retain(|entry, _| entry != path && !entry.starts_with(path));
            Ok(())
        }

        fn copy(&self, from: &Path, to: &Path) -> IdeResult<()> {
            let mut nodes = self.nodes.write().unwrap();
            Self::required_node(&nodes, from)?;
            if nodes.contains_key(to) {
                return Err(IdeError::new(
                    ide_core::error::ErrorKind::AlreadyExists,
                    format!("{} already exists", to.display()),
                ));
            }
            if matches!(Self::required_node(&nodes, from)?, Node::Directory) && to.starts_with(from) {
                return Err(IdeError::invalid(format!("cannot copy {} into itself", from.display())));
            }
            Self::ensure_parent(&mut nodes, to)?;
            let copying: Vec<_> = nodes
                .iter()
                .filter(|(path, _)| *path == from || path.starts_with(from))
                .map(|(path, node)| (path.clone(), node.clone()))
                .collect();
            for (path, node) in copying {
                let suffix = path.strip_prefix(from).expect("selected descendant");
                nodes.insert(to.join(suffix), node);
            }
            Ok(())
        }

        fn set_writable(&self, _path: &Path, _writable: bool) -> IdeResult<()> {
            Err(IdeError::unavailable("permissions are not supported by this filesystem"))
        }
    }

    #[test]
    fn memory_adapter_reads_lists_and_mutates_without_native_paths() {
        let fs = MemoryFileSystem::default();
        fs.create_dir(Path::new("/project/src")).unwrap();
        fs.write_atomic(Path::new("/project/src/main.rs"), b"fn main() {}").unwrap();

        let children = fs.list_dir(Path::new("/project/src")).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "main.rs");
        assert_eq!(fs.read_bytes(Path::new("/project/src/main.rs")).unwrap(), b"fn main() {}");
        assert_eq!(fs.metadata(Path::new("/project/src/main.rs")).unwrap().size, 12);

        fs.rename(Path::new("/project/src/main.rs"), Path::new("/project/src/lib.rs")).unwrap();
        fs.copy(Path::new("/project/src/lib.rs"), Path::new("/project/src/copy.rs")).unwrap();
        fs.delete_permanently(Path::new("/project/src/copy.rs")).unwrap();
        assert_eq!(fs.read_bytes(Path::new("/project/src/lib.rs")).unwrap(), b"fn main() {}");
        assert_eq!(fs.capabilities(), FileSystemCapabilities::default());
        assert_eq!(
            fs.set_writable(Path::new("/project/src/lib.rs"), false).unwrap_err().kind,
            ide_core::error::ErrorKind::Unavailable
        );
        assert_eq!(
            fs.delete(Path::new("/project/src/lib.rs")).unwrap_err().kind,
            ide_core::error::ErrorKind::Unavailable
        );

        crate::save_text_with(&fs, Path::new("/project/src/utf16.txt"), "hello 🚀", "utf-16le", true).unwrap();
        let loaded = crate::load_text_with(&fs, Path::new("/project/src/utf16.txt")).unwrap();
        assert_eq!((loaded.text.as_str(), loaded.encoding.as_str(), loaded.has_bom), ("hello 🚀", "utf-16le", true));
        assert_eq!(
            crate::load_text_as_with(&fs, Path::new("/project/src/utf16.txt"), "utf-16le").unwrap().text,
            "hello 🚀"
        );
        assert_eq!(
            crate::load_text_via_with_fallback(&fs, Path::new("/project/src/utf16.txt"), Some("windows-1252"))
                .unwrap()
                .encoding,
            "utf-16le"
        );

        let legacy_text = "café crème brûlée à la française";
        let (legacy, _, _) = encoding_rs::WINDOWS_1252.encode(legacy_text);
        fs.write_atomic(Path::new("/project/src/legacy.txt"), &legacy).unwrap();
        let loaded =
            crate::load_text_via_with_fallback(&fs, Path::new("/project/src/legacy.txt"), Some("utf-8")).unwrap();
        assert_eq!(loaded.encoding, "utf-8");
        assert!(loaded.text.contains('�'));
        let loaded =
            crate::load_text_via_with_fallback(&fs, Path::new("/project/src/legacy.txt"), Some("not-an-encoding"))
                .unwrap();
        assert_eq!(loaded.encoding, "windows-1252");
        assert_eq!(loaded.text, legacy_text);
    }

    #[test]
    fn native_adapter_uses_existing_atomic_write_and_file_operations() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let native = NativeFileSystem;
        native.create_dir(&root.join("nested")).unwrap();
        let file = root.join("nested/value.txt");

        native.write_atomic(&file, b"before").unwrap();
        assert_eq!(native.read_bytes(&file).unwrap(), b"before");
        assert_eq!(native.metadata(&file).unwrap().size, 6);
        assert_eq!(native.list_dir(&root.join("nested")).unwrap()[0].name, "value.txt");

        native.write_atomic(&file, b"after").unwrap();
        assert_eq!(native.read_bytes(&file).unwrap(), b"after");
        let moved = root.join("moved.txt");
        native.rename(&file, &moved).unwrap();
        native.copy(&moved, &root.join("copy.txt")).unwrap();
        native.delete_permanently(&root.join("copy.txt")).unwrap();
        assert_eq!(native.read_bytes(&moved).unwrap(), b"after");
        assert!(native.capabilities().permissions);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let link = root.join("link.txt");
            symlink(&moved, &link).unwrap();
            let listing = native.list_dir(root).unwrap();
            let link = listing.iter().find(|entry| entry.name == "link.txt").unwrap();
            assert_eq!(link.metadata.kind, FileSystemEntryKind::Symlink);
            assert_eq!(link.target.as_ref().unwrap().kind, FileSystemEntryKind::File);
            assert_eq!(native.metadata(&root.join("link.txt")).unwrap().kind, FileSystemEntryKind::File);
            assert!(native.capabilities().symlinks);
        }
    }
}
