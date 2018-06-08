# "Good Enough" Scala Language Server

This is a "good enough" language server extension for VS Code that aims to simplify development of Scala libraries and
applications by providing basic definition support. It was inspired by Sublime Text's `show_definitions` functionality
added in [Build 3116](https://www.sublimetext.com/3dev).

## What does "good enough" mean?

This means that the extension provides:

- Basic goto definition support by simply matching symbol names
  - Includes Scala classes, traits, objects, types, variables, and functions
- Links to symbol definitions on hover
- Support for searching all symbols in a workspace

The extension *does not* provide:

- Code completion
- Full goto definition support
  - This means the definition you're sent to might not be the correct one, it's just the first one that matches the symbol
- Automatic adding of imports or code refactoring
- Highlighting of warnings or errors

## Installation

The extension is available on the [marketplace](#). If you want to install it from source, follow the steps below in
[Building](#building)

## Configuration

The following configuration options are available:

|Key|Type|Default|
|:---:|:---:|:---:|
|`"goodEnoughScala.hoverEnabled"`|`boolean`|`true`|

## Building

Run the following:

```bash
# Install yarn globally if you haven't already
$ npm install -g yarn
$ yarn
$ yarn package
```

This creates a file named `good-enough-scala-lsp-${version}.vsix`. You can install it by choosing "Install from VSIX..."
in the extensions view.