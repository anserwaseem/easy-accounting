#!/bin/bash

# Put this in your root folder of your project
# run the command chmod +x get_code_context.sh
# then run ./get_code_context.sh

# Use the current directory as the project directory
project_dir=$(pwd)

# Use a fixed name for the output file in the current directory
output_file="${project_dir}/code_context.txt"

# Check if the output file exists and remove it if it does
if [ -f "$output_file" ]; then
  rm "$output_file"
fi

# List of directories to look for
directories=("/" ".erb")

# List of file types to ignore
ignore_files=("*.ico" "*.icns" "*.png" "*.jpg" "*.jpeg" "*.gif" "*.svg" "*.lock" "package-lock.json" "get_code_context.sh")

# List of directories to ignore
ignore_directories=("src" "release" "assets" "node_modules" "dist" "build" "dll" "img" ".github" ".vscode")

# Recursive function to read files and append their content
read_files() {
  for entry in "$1"/*
  do
    if [ -d "$entry" ]; then
      # Echo the directory name
      echo "Entering directory: $entry"

      # Check if the directory should be ignored
      should_ignore=false
      for ignore_dir in "${ignore_directories[@]}"; do
        if [[ "$entry" == *"$ignore_dir"* ]]; then
          should_ignore=true
          break
        fi
      done

      # If the directory should not be ignored, call this function recursively
      if ! $should_ignore; then
        read_files "$entry"
      fi
    elif [ -f "$entry" ]; then
      # Check if the file type should be ignored
      should_ignore=false
      for ignore_pattern in "${ignore_files[@]}"; do
        if [[ "$entry" == *"$ignore_pattern" ]]; then
          should_ignore=true
          break
        fi
      done

      # If the file type should not be ignored, append its relative path and content to the output file
      if ! $should_ignore; then
        relative_path=${entry#"$project_dir/"}
        echo "Processing file: $relative_path"
        echo "// File: $relative_path" >> "$output_file"
        cat "$entry" >> "$output_file"
        echo "" >> "$output_file"
      fi
    fi
  done
}

# Call the recursive function for each specified directory in the project directory
for dir in "${directories[@]}"; do
  if [ -d "${project_dir}/${dir}" ]; then
    read_files "${project_dir}/${dir}"
  fi
done
